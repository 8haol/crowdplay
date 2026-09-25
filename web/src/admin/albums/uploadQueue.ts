import { RpcError, errorText } from "../../lib/api";
import { albumSign, type UploadSigned } from "./albumApi";
import { takenAtFor } from "./exif";
import { makeThumbs, type Thumbs } from "./thumbs";

/*
 * 上传队列。每本相册一条，挂在模块级的表里：在后台里切到别的页面再回来，
 * 队列和进度都还在；只要还有文件没传完，关标签页前浏览器会提醒。
 *
 * 每个文件：生成小图 → upload（登记 + 拿 PUT URL）→ XHR PUT 原片（要进度）
 *           → PUT 两张小图 → complete。
 * 任一步失败：先 abort（删掉这张的对象和 pending 行），再标失败。
 * 重试从 upload 重新登记；小图和拍摄时间已经算过的就不再算。
 */

export const MAX_FILE_BYTES = 5_000_000_000;
// R2 只走 HTTP/1.1，浏览器对一个域名最多 6 条连接；留两条给网格里的缩略图。
const CONCURRENCY = 4;

export type UploadStatus = "queued" | "preparing" | "uploading" | "finishing" | "done" | "failed";

export interface UploadItemView {
  id: string;
  name: string;
  size: number;
  status: UploadStatus;
  loaded: number;
  error: string | null;
}

export interface UploadSnapshot {
  items: UploadItemView[];
  totalBytes: number;
  loadedBytes: number;
  /** 还没结束（排队、生成小图、上传、收尾）的个数。 */
  active: number;
  failed: number;
  done: number;
  /** 每传完一张加一；详情页据此重新拉照片列表。 */
  completedVersion: number;
}

interface Item extends UploadItemView {
  file: File;
  contentType: string;
  thumbs: Thumbs | null;
  takenAt: string | null | undefined;
  photoId: string | null;
  xhr: XMLHttpRequest | null;
  cancelled: boolean;
}

/* ----------------------------------------------------------- 筛文件 */

/*
 * content_type 为空（或是 application/octet-stream）的按扩展名猜。
 * 服务端只收 ^(image|video)/，猜不出的直接跳过并提示。
 */
const EXT_TYPES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", jpe: "image/jpeg", png: "image/png", gif: "image/gif",
  webp: "image/webp", avif: "image/avif", bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff",
  heic: "image/heic", heif: "image/heif", hif: "image/heif",
  dng: "image/x-adobe-dng", cr2: "image/x-canon-cr2", cr3: "image/x-canon-cr3", nef: "image/x-nikon-nef",
  arw: "image/x-sony-arw", raf: "image/x-fuji-raf", orf: "image/x-olympus-orf", rw2: "image/x-panasonic-rw2",
  mov: "video/quicktime", qt: "video/quicktime", mp4: "video/mp4", m4v: "video/x-m4v", webm: "video/webm",
  mkv: "video/x-matroska", avi: "video/x-msvideo", "3gp": "video/3gpp", mts: "video/mp2t", m2ts: "video/mp2t",
  wmv: "video/x-ms-wmv",
};

export function guessContentType(file: File): string | null {
  const type = file.type.toLowerCase();
  if (/^(image|video)\//.test(type)) return type;
  const ext = file.name.includes(".") ? file.name.split(".").pop()?.toLowerCase() ?? "" : "";
  return EXT_TYPES[ext] ?? null;
}

export interface AcceptedFile {
  file: File;
  contentType: string;
}

export interface Screened {
  accepted: AcceptedFile[];
  unsupported: number;
  tooLarge: number;
}

export function screenFiles(files: File[]): Screened {
  const out: Screened = { accepted: [], unsupported: 0, tooLarge: 0 };
  for (const file of files) {
    // macOS 在外置盘上留下的 ._IMG_0001.JPG 和 .DS_Store：不是照片，也不值得提示。
    if (file.name.startsWith(".")) continue;
    const contentType = guessContentType(file);
    if (!contentType || file.size <= 0) { out.unsupported++; continue; }
    if (file.size > MAX_FILE_BYTES) { out.tooLarge++; continue; }
    out.accepted.push({ file, contentType });
  }
  return out;
}

/* 拖进来的文件夹：webkitGetAsEntry 拿到的入口递归展开成文件。 */
const isFileEntry = (entry: FileSystemEntry): entry is FileSystemFileEntry => entry.isFile;
const isDirEntry = (entry: FileSystemEntry): entry is FileSystemDirectoryEntry => entry.isDirectory;

export async function filesFromEntries(entries: FileSystemEntry[]): Promise<File[]> {
  const out: File[] = [];
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (isFileEntry(entry)) {
      const file = await new Promise<File | null>((resolve) => entry.file(resolve, () => resolve(null)));
      if (file) out.push(file);
      return;
    }
    if (isDirEntry(entry)) {
      const reader = entry.createReader();
      // readEntries 一次最多给 100 个，要一直读到空为止。
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve) => reader.readEntries(resolve, () => resolve([])));
        if (batch.length === 0) break;
        for (const child of batch) await walk(child);
      }
    }
  };
  for (const entry of entries) await walk(entry);
  return out;
}

/* ------------------------------------------------------ 关页面提醒 */

const unloadHolders = new Set<object>();
function onBeforeUnload(event: BeforeUnloadEvent) {
  event.preventDefault();
  event.returnValue = "";
}

/** 有东西在传（上传或下载到文件夹）时拦一下关标签页。 */
export function holdUnload(holder: object, on: boolean) {
  const before = unloadHolders.size;
  if (on) unloadHolders.add(holder);
  else unloadHolders.delete(holder);
  if (before === 0 && unloadHolders.size > 0) window.addEventListener("beforeunload", onBeforeUnload);
  if (before > 0 && unloadHolders.size === 0) window.removeEventListener("beforeunload", onBeforeUnload);
}

/* ------------------------------------------------------------ 队列 */

const CANCELLED = new Error("CANCELLED");
let nextItemId = 1;

export class UploadQueue {
  private items: Item[] = [];
  private running = 0;
  private completed = 0;
  private listeners = new Set<() => void>();
  private snapshot: UploadSnapshot;
  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly adminKey: string;
  private readonly albumId: string;

  constructor(adminKey: string, albumId: string) {
    this.adminKey = adminKey;
    this.albumId = albumId;
    this.snapshot = this.build();
  }

  /* useSyncExternalStore 要求这两个引用稳定，所以写成箭头属性。 */
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = () => this.snapshot;

  add(files: AcceptedFile[]) {
    for (const { file, contentType } of files) {
      this.items.push({
        id: String(nextItemId++),
        name: file.name,
        size: file.size,
        status: "queued",
        loaded: 0,
        error: null,
        file,
        contentType,
        thumbs: null,
        takenAt: undefined,
        photoId: null,
        xhr: null,
        cancelled: false,
      });
    }
    this.pump();
    this.emit(true);
  }

  /** 还没登记到服务端的字节数：服务端的 used_bytes 里还没算它们。 */
  unreservedBytes(): number {
    return this.items
      .filter((item) => item.status === "queued" || item.status === "preparing")
      .reduce((sum, item) => sum + item.size, 0);
  }

  retry(id: string) {
    const item = this.items.find((entry) => entry.id === id);
    if (!item || item.status !== "failed") return;
    item.status = "queued";
    item.error = null;
    item.loaded = 0;
    this.pump();
    this.emit(true);
  }

  retryFailed() {
    for (const item of this.items) {
      if (item.status === "failed") { item.status = "queued"; item.error = null; item.loaded = 0; }
    }
    this.pump();
    this.emit(true);
  }

  /** 取消（进行中的）或移出列表（已结束的）。进行中的会在 process 的 catch 里 abort 并移除。 */
  remove(id: string) {
    const item = this.items.find((entry) => entry.id === id);
    if (!item) return;
    if (item.status === "queued" || item.status === "done" || item.status === "failed") {
      this.items = this.items.filter((entry) => entry !== item);
    } else {
      item.cancelled = true;
      item.xhr?.abort();
    }
    this.emit(true);
  }

  cancelAll() {
    for (const item of [...this.items]) {
      if (item.status !== "done" && item.status !== "failed") this.remove(item.id);
    }
  }

  clearFinished() {
    this.items = this.items.filter((item) => item.status !== "done");
    this.emit(true);
  }

  private pump() {
    while (this.running < CONCURRENCY) {
      const next = this.items.find((item) => item.status === "queued");
      if (!next) break;
      this.running++;
      next.status = "preparing";
      void this.process(next).finally(() => {
        this.running--;
        this.pump();
        this.emit(true);
      });
    }
    holdUnload(this, this.items.some((item) => isActive(item.status)));
  }

  private async process(item: Item) {
    try {
      if (item.takenAt === undefined) item.takenAt = await takenAtFor(item.file);
      // 小图和原片并行：原片一登记就开始传，解码缩图在后台排队。以前先等小图做完再登记，
      // 而小图是全局排成一行做的，几个并发名额常常都卡在等解码，上行带宽闲着。
      const thumbsReady: Promise<Thumbs> = item.thumbs
        ? Promise.resolve(item.thumbs)
        : makeThumbs(item.file, item.contentType).then((thumbs) => (item.thumbs = thumbs));

      const signed = await albumSign<UploadSigned>("upload", {
        admin_key: this.adminKey,
        album_id: this.albumId,
        filename: item.name,
        content_type: item.contentType,
        size_bytes: item.size,
        taken_at: item.takenAt,
      });
      item.photoId = signed.photo_id;
      if (item.cancelled) throw CANCELLED;

      item.status = "uploading";
      this.emit(true);
      await this.put(item, signed.put_original, item.file, item.contentType, true);
      const thumbs = await thumbsReady;
      if (item.cancelled) throw CANCELLED;
      if (thumbs.thumb) await this.put(item, signed.put_thumb, thumbs.thumb, "image/jpeg", false);
      if (thumbs.preview) await this.put(item, signed.put_preview, thumbs.preview, "image/jpeg", false);
      if (item.cancelled) throw CANCELLED;

      item.status = "finishing";
      this.emit(true);
      await albumSign("complete", { admin_key: this.adminKey, photo_id: item.photoId });
      item.status = "done";
      item.loaded = item.size;
      item.photoId = null;
      // 传完就放掉小图和文件引用占的内存；done 的项不会再重试。
      item.thumbs = { thumb: null, preview: null };
      this.completed++;
    } catch (err) {
      const photoId = item.photoId;
      item.photoId = null;
      item.xhr = null;
      if (photoId) {
        await albumSign("abort", { admin_key: this.adminKey, photo_id: photoId }).catch(() => undefined);
      }
      if (item.cancelled) {
        this.items = this.items.filter((entry) => entry !== item);
        return;
      }
      item.status = "failed";
      item.loaded = 0;
      item.error = errorText(err instanceof RpcError ? err : new RpcError("NETWORK"));
    }
  }

  /** XHR 而不是 fetch：只有 XHR 有上传进度。不手设 Content-Length，浏览器不许。 */
  private put(item: Item, url: string, body: Blob, contentType: string, track: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      item.xhr = xhr;
      xhr.open("PUT", url);
      xhr.setRequestHeader("Content-Type", contentType);
      if (track) {
        xhr.upload.onprogress = (event) => {
          item.loaded = event.loaded;
          this.emit(false);
        };
      }
      xhr.onload = () => {
        item.xhr = null;
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new RpcError("STORAGE_ERROR"));
      };
      xhr.onerror = () => { item.xhr = null; reject(new RpcError("NETWORK")); };
      xhr.ontimeout = () => { item.xhr = null; reject(new RpcError("NETWORK")); };
      xhr.onabort = () => { item.xhr = null; reject(CANCELLED); };
      xhr.send(body);
    });
  }

  /** 状态变化立刻推；进度事件一秒几十次，攒 100ms 推一次。 */
  private emit(now: boolean) {
    if (now) {
      if (this.emitTimer) { clearTimeout(this.emitTimer); this.emitTimer = null; }
      this.publish();
      return;
    }
    this.emitTimer ??= setTimeout(() => { this.emitTimer = null; this.publish(); }, 100);
  }

  private publish() {
    this.snapshot = this.build();
    holdUnload(this, this.snapshot.active > 0);
    for (const listener of this.listeners) listener();
  }

  private build(): UploadSnapshot {
    let totalBytes = 0, loadedBytes = 0, active = 0, failed = 0, done = 0;
    const items = this.items.map((item): UploadItemView => {
      totalBytes += item.size;
      loadedBytes += item.status === "done" ? item.size : item.loaded;
      if (isActive(item.status)) active++;
      if (item.status === "failed") failed++;
      if (item.status === "done") done++;
      return { id: item.id, name: item.name, size: item.size, status: item.status, loaded: item.loaded, error: item.error };
    });
    return { items, totalBytes, loadedBytes, active, failed, done, completedVersion: this.completed };
  }
}

function isActive(status: UploadStatus): boolean {
  return status === "queued" || status === "preparing" || status === "uploading" || status === "finishing";
}

const queues = new Map<string, UploadQueue>();

export function uploadQueueFor(adminKey: string, albumId: string): UploadQueue {
  const key = `${adminKey}\u0000${albumId}`;
  let queue = queues.get(key);
  if (!queue) {
    queue = new UploadQueue(adminKey, albumId);
    queues.set(key, queue);
  }
  return queue;
}
