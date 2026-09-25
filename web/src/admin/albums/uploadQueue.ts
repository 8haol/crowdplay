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
 *
 * 手机上网页没法真正后台上传：切走或锁屏几秒，页面就被挂起，请求跟着断。
 * 所以退而求其次——有东西在传时让屏幕常亮（keepAwake），网络类的失败不直接
 * 判死，先进 waiting，按退避时间自动重传；页面回到前台、网络恢复时立刻接着传。
 */

export const MAX_FILE_BYTES = 5_000_000_000;
// R2 只走 HTTP/1.1，浏览器对一个域名最多 6 条连接；留两条给网格里的缩略图。
const CONCURRENCY = 4;

// waiting = 网络类失败，等一会儿自动重传；failed = 自动重传也放弃了，或者重试也没用的错。
export type UploadStatus = "queued" | "preparing" | "uploading" | "finishing" | "waiting" | "done" | "failed";

// 自动重传的间隔，第 n 次用第 n 个；用完就判 failed，等人点重试或页面重新回到前台。
const RETRY_DELAYS_MS = [3_000, 10_000, 30_000, 60_000, 60_000];
// 页面在前台时，一个 PUT 这么久没有任何进度就当它断了。iOS 从后台回来时，
// 被挂起时断掉的请求有时既不报错也不动，只能靠这个把它揪出来。
const STALL_MS = 30_000;
// 这些错是网络 / 服务端一时不通，过一会儿再试大概率能好；其余（口令错、文件不合法、
// 相册被删）重试也没用，直接 failed。
const TRANSIENT = new Set(["NETWORK", "STORAGE_ERROR", "RPC_UNAVAILABLE", "RATE_LIMITED"]);
const isTransient = (code: string) => TRANSIENT.has(code) || /^HTTP_5\d\d$/.test(code);

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
  /** 看门狗判定卡死、主动 abort 的：onabort 要报 NETWORK 而不是 CANCELLED。 */
  stalled: boolean;
  lastProgressAt: number;
  /** 连着自动重传了几次，传成功或页面重新回到前台时清零。 */
  autoRetries: number;
  /** 上次失败是不是网络类的（值得自动重传）。 */
  transient: boolean;
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

/** 有东西在传（上传或下载到文件夹）时拦一下关标签页，并让屏幕常亮。 */
export function holdUnload(holder: object, on: boolean) {
  const before = unloadHolders.size;
  if (on) unloadHolders.add(holder);
  else unloadHolders.delete(holder);
  if (before === 0 && unloadHolders.size > 0) window.addEventListener("beforeunload", onBeforeUnload);
  if (before > 0 && unloadHolders.size === 0) window.removeEventListener("beforeunload", onBeforeUnload);
  if ((before === 0) !== (unloadHolders.size === 0)) void keepAwake();
}

/* ------------------------------------------------------- 屏幕常亮 */

/*
 * Screen Wake Lock：iOS 16.4+、安卓 Chrome 都支持。页面一隐藏系统就自动释放，
 * 所以回到前台要重新申请（见下面的 visibilitychange）。低电量模式下可能被拒，拒了就算了，
 * 只是回到「会自动锁屏」的老样子。
 */
let wakeLock: WakeLockSentinel | null = null;
let wakeRequesting = false;

async function keepAwake() {
  const wanted = unloadHolders.size > 0;
  if (!wanted) {
    const lock = wakeLock;
    wakeLock = null;
    if (lock) void lock.release().catch(() => undefined);
    return;
  }
  if (wakeLock || wakeRequesting || !("wakeLock" in navigator) || document.visibilityState !== "visible") return;
  wakeRequesting = true;
  try {
    const lock = await navigator.wakeLock.request("screen");
    lock.addEventListener("release", () => { if (wakeLock === lock) wakeLock = null; });
    wakeLock = lock;
    // 申请的这一会儿里传完了：马上还回去。
    if (unloadHolders.size === 0) await keepAwake();
  } catch {
    // 被拒（低电量、没有用户手势、不是 https）：保持原样。
  } finally {
    wakeRequesting = false;
  }
}

/* 页面回到前台、网络恢复：重新申请常亮，所有队列立刻接着传。只挂一次。 */
let lifecycleBound = false;
function bindLifecycle() {
  if (lifecycleBound || typeof document === "undefined") return;
  lifecycleBound = true;
  const wake = () => {
    if (document.visibilityState !== "visible") return;
    void keepAwake();
    for (const queue of queues.values()) queue.resume(true);
  };
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("online", wake);
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
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
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
        stalled: false,
        lastProgressAt: 0,
        autoRetries: 0,
        transient: false,
      });
    }
    this.pump();
    this.emit(true);
  }

  retry(id: string) {
    const item = this.items.find((entry) => entry.id === id);
    if (!item || (item.status !== "failed" && item.status !== "waiting")) return;
    requeue(item, true);
    this.pump();
    this.emit(true);
  }

  retryFailed() {
    for (const item of this.items) {
      if (item.status === "failed" || item.status === "waiting") requeue(item, true);
    }
    this.pump();
    this.emit(true);
  }

  /**
   * 把 waiting 的重新排队。fresh = 页面刚回到前台 / 网络刚恢复：情况变了，
   * 连已经放弃自动重传的网络类失败也再给一轮机会，并把正在传的看门狗计时重置——
   * 后台那段时间没有进度不算卡死。
   */
  resume(fresh = false) {
    if (this.resumeTimer) { clearTimeout(this.resumeTimer); this.resumeTimer = null; }
    let changed = false;
    const now = Date.now();
    for (const item of this.items) {
      if (item.status === "waiting" || (fresh && item.status === "failed" && item.transient)) {
        requeue(item, fresh);
        changed = true;
      } else if (fresh && item.status === "uploading") {
        item.lastProgressAt = now;
      }
    }
    if (!changed) return;
    this.pump();
    this.emit(true);
  }

  /** 有 waiting 的就排一个定时器；页面在后台或断网时不排，等 bindLifecycle 的事件叫醒。 */
  private scheduleResume() {
    if (this.resumeTimer) return;
    const waiting = this.items.filter((item) => item.status === "waiting");
    if (waiting.length === 0) return;
    if (document.visibilityState !== "visible" || !navigator.onLine) return;
    // autoRetries 在进 waiting 时已经加过 1，第一次重传用 RETRY_DELAYS_MS[0]。
    const attempt = Math.min(...waiting.map((item) => item.autoRetries)) - 1;
    const delay = RETRY_DELAYS_MS[Math.min(Math.max(attempt, 0), RETRY_DELAYS_MS.length - 1)];
    this.resumeTimer = setTimeout(() => { this.resumeTimer = null; this.resume(); }, delay);
  }

  /** 前台时每 10 秒查一次：有进度才算活着。 */
  private checkStalls() {
    if (document.visibilityState !== "visible") return;
    const now = Date.now();
    for (const item of this.items) {
      if (item.status === "uploading" && item.xhr && now - item.lastProgressAt > STALL_MS) {
        item.stalled = true;
        item.xhr.abort();
      }
    }
  }

  /** 取消（进行中的）或移出列表（已结束的）。进行中的会在 process 的 catch 里 abort 并移除。 */
  remove(id: string) {
    const item = this.items.find((entry) => entry.id === id);
    if (!item) return;
    if (item.status === "queued" || item.status === "waiting" || item.status === "done" || item.status === "failed") {
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
    if (this.resumeTimer) { clearTimeout(this.resumeTimer); this.resumeTimer = null; }
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
        this.scheduleResume();
        this.emit(true);
      });
    }
    if (this.running > 0 && !this.watchdog) this.watchdog = setInterval(() => this.checkStalls(), 10_000);
    if (this.running === 0 && this.watchdog) { clearInterval(this.watchdog); this.watchdog = null; }
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
      item.autoRetries = 0;
      this.completed++;
    } catch (err) {
      const photoId = item.photoId;
      item.photoId = null;
      item.xhr = null;
      item.stalled = false;
      if (photoId) {
        await albumSign("abort", { admin_key: this.adminKey, photo_id: photoId }).catch(() => undefined);
      }
      if (item.cancelled) {
        this.items = this.items.filter((entry) => entry !== item);
        return;
      }
      const rpcErr = err instanceof RpcError ? err : new RpcError("NETWORK");
      item.loaded = 0;
      item.error = errorText(rpcErr);
      item.transient = isTransient(rpcErr.code);
      if (item.transient && item.autoRetries < RETRY_DELAYS_MS.length) {
        item.autoRetries++;
        item.status = "waiting";
      } else {
        item.status = "failed";
      }
    }
  }

  /** XHR 而不是 fetch：只有 XHR 有上传进度。不手设 Content-Length，浏览器不许。 */
  private put(item: Item, url: string, body: Blob, contentType: string, track: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      item.xhr = xhr;
      item.lastProgressAt = Date.now();
      xhr.open("PUT", url);
      xhr.setRequestHeader("Content-Type", contentType);
      xhr.upload.onprogress = (event) => {
        item.lastProgressAt = Date.now();
        if (!track) return;
        item.loaded = event.loaded;
        this.emit(false);
      };
      xhr.onload = () => {
        item.xhr = null;
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new RpcError("STORAGE_ERROR"));
      };
      xhr.onerror = () => { item.xhr = null; reject(new RpcError("NETWORK")); };
      xhr.ontimeout = () => { item.xhr = null; reject(new RpcError("NETWORK")); };
      xhr.onabort = () => { item.xhr = null; reject(item.stalled ? new RpcError("NETWORK") : CANCELLED); };
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

/** waiting 也算「还没结束」：它还会自己再传，屏幕要继续亮着、关页面要继续提醒。 */
function isActive(status: UploadStatus): boolean {
  return status === "queued" || status === "preparing" || status === "uploading" || status === "finishing" || status === "waiting";
}

function requeue(item: Item, resetCount: boolean) {
  item.status = "queued";
  item.error = null;
  item.loaded = 0;
  if (resetCount) item.autoRetries = 0;
}

const queues = new Map<string, UploadQueue>();

export function uploadQueueFor(adminKey: string, albumId: string): UploadQueue {
  bindLifecycle();
  const key = `${adminKey}\u0000${albumId}`;
  let queue = queues.get(key);
  if (!queue) {
    queue = new UploadQueue(adminKey, albumId);
    queues.set(key, queue);
  }
  return queue;
}
