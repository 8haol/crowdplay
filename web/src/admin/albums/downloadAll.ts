import { RpcError, errorText } from "../../lib/api";
import { linksFor, type DownloadLink, type DownloadQuality } from "./albumApi";
import type { AlbumPhoto } from "./albumTypes";

/*
 * 下载原片。
 *
 * 「全部下载到文件夹」只在有 showDirectoryPicker 的浏览器（Chrome / Edge 桌面）出现：
 * 选一个文件夹，同时下 3 个，fetch 的响应体直接流进文件，不经内存攒整个文件。
 * 同名加「 (1)」后缀；文件夹里已经有同名且大小一样的就跳过，这样中途失败后
 * 再下一次同一个文件夹，只会补上缺的那些。
 *
 * 其他浏览器只能一张张下：拿到带 attachment 的 URL，用隐藏的 <a> 点一下。
 *
 * 视频可以选下低画质版（quality = "proxy"）：文件名加 _720p，大小事先不知道，
 * 进度的总量在拿到响应头之后再校正。
 *
 * File System Access API 在 TypeScript 的 DOM 库里不全，这里只声明用到的那几个方法。
 */

interface FileHandleLike {
  getFile(): Promise<File>;
  createWritable(): Promise<WritableStream<Uint8Array>>;
}

export interface DirHandleLike {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>;
  removeEntry(name: string): Promise<void>;
}

type DirectoryPicker = (options?: { mode?: "read" | "readwrite" }) => Promise<DirHandleLike>;

function directoryPicker(): DirectoryPicker | null {
  if (typeof window === "undefined") return null;
  const picker = (window as Window & { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
  return typeof picker === "function" ? picker.bind(window) : null;
}

export function canSaveToFolder(): boolean {
  return directoryPicker() !== null;
}

/**
 * 弹出选文件夹。必须在点击事件里直接调用（浏览器要求用户手势），
 * 所以和真正的下载拆成两步。用户点了取消返回 null。
 */
export async function pickFolder(): Promise<DirHandleLike | null> {
  const picker = directoryPicker();
  if (!picker) return null;
  try {
    return await picker({ mode: "readwrite" });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return null;
    throw err;
  }
}

export interface FolderProgress {
  total: number;
  done: number;
  /** 文件夹里已经有一模一样的，没有重下。 */
  skipped: number;
  failed: Array<{ id: string; filename: string; error: string }>;
  totalBytes: number;
  loadedBytes: number;
  running: boolean;
  cancelled: boolean;
}

const CONCURRENCY = 3;
const LINK_BATCH = 100;
/** 下载 URL 签 1 小时；一批用超过 45 分钟就重新要，别让后面的文件拿到过期链接。 */
const LINK_TTL_MS = 45 * 60 * 1000;

export async function downloadToFolder(options: {
  adminKey: string;
  dir: DirHandleLike;
  photos: AlbumPhoto[];
  quality: DownloadQuality;
  signal: AbortSignal;
  onProgress: (progress: FolderProgress) => void;
}): Promise<FolderProgress> {
  const { adminKey, dir, photos, quality, signal, onProgress } = options;
  const progress: FolderProgress = {
    total: photos.length,
    done: 0,
    skipped: 0,
    failed: [],
    totalBytes: photos.reduce((sum, photo) => sum + photo.size_bytes, 0),
    loadedBytes: 0,
    running: true,
    cancelled: false,
  };

  let reportTimer: ReturnType<typeof setTimeout> | null = null;
  const report = (now = false) => {
    if (now) {
      if (reportTimer) { clearTimeout(reportTimer); reportTimer = null; }
      onProgress({ ...progress, failed: [...progress.failed] });
      return;
    }
    reportTimer ??= setTimeout(() => {
      reportTimer = null;
      onProgress({ ...progress, failed: [...progress.failed] });
    }, 120);
  };
  report(true);

  // 下载链接按 100 张一批、用到时才要。
  const batches = new Map<number, { at: number; links: Promise<Record<string, DownloadLink>> }>();
  const linkFor = async (index: number): Promise<DownloadLink | null> => {
    const key = Math.floor(index / LINK_BATCH);
    let batch = batches.get(key);
    if (!batch || Date.now() - batch.at > LINK_TTL_MS) {
      const links = linksFor(adminKey, photos.slice(key * LINK_BATCH, (key + 1) * LINK_BATCH), quality);
      batch = { at: Date.now(), links };
      batches.set(key, batch);
      links.catch(() => { if (batches.get(key) === batch) batches.delete(key); });
    }
    const links = await batch.links;
    return links[photos[index].id] ?? null;
  };

  const reserved = new Set<string>();
  let cursor = 0;

  const worker = async () => {
    while (!signal.aborted) {
      const index = cursor++;
      if (index >= photos.length) return;
      const photo = photos[index];
      let counted = 0;
      try {
        const link = await linkFor(index);
        if (!link) throw new RpcError("PHOTO_NOT_FOUND");
        // 低画质版的大小事先不知道：-1 永远对不上，同名的就加 (1)，不会被当成「已经下过」跳过。
        const name = await claimName(dir, reserved, link.filename || photo.filename, link.proxy ? -1 : photo.size_bytes);
        if (name === null) {
          progress.skipped++;
          progress.loadedBytes += photo.size_bytes;
          report();
          continue;
        }
        await saveOne(dir, name, link.url, signal, (bytes) => {
          counted += bytes;
          progress.loadedBytes += bytes;
          report();
        }, (size) => {
          // 总量里先按原片大小算的，换成实际要下的大小。
          progress.totalBytes += size - photo.size_bytes;
        });
        progress.done++;
      } catch (err) {
        progress.loadedBytes -= counted;
        if (signal.aborted) return;
        progress.failed.push({ id: photo.id, filename: photo.filename, error: describe(err) });
      }
      report();
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, photos.length) }, worker));
  progress.running = false;
  progress.cancelled = signal.aborted;
  report(true);
  return progress;
}

async function saveOne(
  dir: DirHandleLike,
  name: string,
  url: string,
  signal: AbortSignal,
  onBytes: (bytes: number) => void,
  onSize: (bytes: number) => void,
) {
  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) throw new RpcError("STORAGE_ERROR");
  const length = Number(res.headers.get("content-length"));
  if (Number.isFinite(length) && length > 0) onSize(length);
  const handle = await dir.getFileHandle(name, { create: true });
  try {
    const writable = await handle.createWritable();
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        onBytes(chunk.byteLength);
        controller.enqueue(chunk);
      },
    });
    await res.body.pipeThrough(counter).pipeTo(writable, { signal });
  } catch (err) {
    // 半截文件不留：下次同一个文件夹再下时它会被当成「同名不同大小」而多出一个副本。
    await dir.removeEntry(name).catch(() => undefined);
    throw err;
  }
}

/**
 * 给这张照片在文件夹里找一个名字。返回 null 表示文件夹里已经有同名、同大小的文件，跳过。
 * reserved 记着这一轮已经用掉的名字（小写比较：macOS / Windows 的文件名不分大小写），
 * 三个并发的 worker 不会抢到同一个名字。
 */
async function claimName(dir: DirHandleLike, reserved: Set<string>, wanted: string, size: number): Promise<string | null> {
  const clean = safeName(wanted);
  const dot = clean.lastIndexOf(".");
  const base = dot > 0 ? clean.slice(0, dot) : clean;
  const ext = dot > 0 ? clean.slice(dot) : "";
  for (let n = 0; n < 10_000; n++) {
    const candidate = n === 0 ? clean : `${base} (${n})${ext}`;
    const lower = candidate.toLowerCase();
    if (reserved.has(lower)) continue;
    reserved.add(lower);
    try {
      const existing = await dir.getFileHandle(candidate);
      const file = await existing.getFile();
      if (file.size === size) return null;
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotFoundError") return candidate;
      // 同名的是个文件夹，或者读不了：换下一个名字
    }
  }
  throw new RpcError("BAD_FILE");
}

function safeName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_").replace(/^\.+/, "").trim();
  return cleaned || "file";
}

function describe(err: unknown): string {
  if (err instanceof RpcError) return errorText(err);
  if (err instanceof DOMException && err.name === "QuotaExceededError") return "磁盘空间不够";
  if (err instanceof DOMException && err.name === "NotAllowedError") return "没有这个文件夹的写入权限";
  return errorText(new RpcError("NETWORK"));
}

/* ------------------------------------------------------------ 单张 */

function clickLink(link: DownloadLink) {
  const anchor = document.createElement("a");
  anchor.href = link.url;
  anchor.download = link.filename; // 跨域时浏览器忽略它；真正起作用的是 R2 返回的 content-disposition
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/** 低画质版的 URL 不带 attachment，点了会直接播：先下成 Blob，用同源的 blob: URL 才能让 download 生效。 */
async function saveLink(link: DownloadLink) {
  if (!link.proxy) {
    clickLink(link);
    return;
  }
  const res = await fetch(link.url);
  if (!res.ok) throw new RpcError("STORAGE_ERROR");
  const url = URL.createObjectURL(await res.blob());
  clickLink({ url, filename: link.filename });
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function downloadPhoto(adminKey: string, photo: AlbumPhoto, quality: DownloadQuality = "original"): Promise<void> {
  const links = await linksFor(adminKey, [photo], quality);
  const link = links[photo.id];
  if (!link) throw new RpcError("PHOTO_NOT_FOUND");
  await saveLink(link);
}

/** 没有选文件夹能力的浏览器：一张张触发下载，中间隔一下，免得被当成弹窗轰炸拦掉。 */
export async function downloadOneByOne(
  adminKey: string,
  photos: AlbumPhoto[],
  quality: DownloadQuality = "original",
  signal?: AbortSignal,
): Promise<void> {
  const links = await linksFor(adminKey, photos, quality);
  for (const photo of photos) {
    if (signal?.aborted) return;
    const link = links[photo.id];
    if (!link) continue;
    await saveLink(link);
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
}
