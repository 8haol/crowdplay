import { RpcError, errorText } from "../../lib/api";
import { linksFor, usesProxy, type DownloadQuality } from "./albumApi";
import type { AlbumPhoto } from "./albumTypes";

/*
 * iPhone / iPad 上「存到相册」。
 *
 * 网页没法直接写系统相册，只能把文件交给系统分享面板（navigator.share({ files })），
 * 用户在面板里点「存储图像 / 存储视频」，文件进「照片」App，而不是「文件」App。
 * 建相簿、指定相簿做不到，那得是原生 App。
 *
 * 限制和对策：
 * - share 必须紧跟用户点击。先下载再分享，下载久了点击就「过期」，Safari 报 NotAllowedError。
 *   所以分两步：先把一批文件下到内存，面板上的按钮变成「存 N 张到相册」，再点一下才弹面板。
 *   刚点完就下好的（单张小照片）会直接试一次，失败了再等用户点。
 * - 整批文件都在内存里，太多会把 Safari 撑崩：按张数和字节数分批，存完一批再下下一批。
 * - 一批里只要有一个相册不认的格式，面板里的「存储」就不出现：
 *   这些文件（MKV / AVI / WebP / RAW 之类）挑出来，留给普通下载。
 */

/** iOS「照片」能收的格式。宁可少列：列多了会让整批的「存储」按钮消失。 */
const PHOTOS_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/gif",
  "video/quicktime",
  "video/mp4",
  "video/x-m4v",
]);

const BATCH_COUNT = 20;
const BATCH_BYTES = 300 * 1024 * 1024;
/** 点击之后多久内下好还算「刚点过」，可以直接弹面板。WebKit 的用户手势有效期大约 5 秒。 */
const GESTURE_MS = 4000;

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPadOS 默认用桌面版 UA，自称 Macintosh；靠触摸点区分。
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function canSaveToPhotos(): boolean {
  if (!isIOS() || typeof navigator.share !== "function" || typeof navigator.canShare !== "function") return false;
  try {
    return navigator.canShare({ files: [new File([new Uint8Array(1)], "a.jpg", { type: "image/jpeg" })] });
  } catch {
    return false;
  }
}

export function photosCanTake(photo: Pick<AlbumPhoto, "content_type">): boolean {
  return PHOTOS_TYPES.has(photo.content_type.toLowerCase());
}

export function planBatches(photos: AlbumPhoto[], sizeOf: (photo: AlbumPhoto) => number = (photo) => photo.size_bytes): AlbumPhoto[][] {
  const batches: AlbumPhoto[][] = [];
  let current: AlbumPhoto[] = [];
  let bytes = 0;
  for (const photo of photos) {
    if (current.length > 0 && (current.length >= BATCH_COUNT || bytes + sizeOf(photo) > BATCH_BYTES)) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(photo);
    bytes += sizeOf(photo);
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export interface SaveState {
  /** 这一轮要存进相册的总数（不含格式不支持的）。 */
  total: number;
  saved: number;
  batchIndex: number;
  batchCount: number;
  /** 当前这一批。 */
  batchSize: number;
  batchBytes: number;
  loadedBytes: number;
  /** 已经下到内存、等着交给系统面板的张数。 */
  readyCount: number;
  phase: "fetching" | "ready" | "sharing" | "done";
  failed: Array<{ id: string; filename: string; error: string }>;
  /** 相册收不了的格式，留给普通下载。 */
  unsupported: AlbumPhoto[];
  cancelled: boolean;
}

/**
 * 一轮「存到相册」。onChange 每次状态变化都会给一份新的快照。
 * share() 必须在点击事件里同步调用（不要先 await 别的）。
 */
export class SaveToPhotosJob {
  private state: SaveState;
  private batches: AlbumPhoto[][];
  private files: File[] = [];
  private filePhotos: AlbumPhoto[] = [];
  private ctrl = new AbortController();
  private startedAt = Date.now();
  private reportTimer: ReturnType<typeof setTimeout> | null = null;
  private adminKey: string;
  private quality: DownloadQuality;
  private onChange: (state: SaveState) => void;

  constructor(adminKey: string, photos: AlbumPhoto[], quality: DownloadQuality, onChange: (state: SaveState) => void) {
    this.adminKey = adminKey;
    this.quality = quality;
    this.onChange = onChange;
    // 低画质版一律是 MP4：原片是 MKV 之类相册不认的，选低画质反而能存进去。
    const takes = (photo: AlbumPhoto) => photosCanTake(photo) || usesProxy(photo, quality);
    const supported = photos.filter(takes);
    this.batches = planBatches(supported, (photo) => this.sizeOf(photo));
    this.state = {
      total: supported.length,
      saved: 0,
      batchIndex: 0,
      batchCount: this.batches.length,
      batchSize: 0,
      batchBytes: 0,
      loadedBytes: 0,
      readyCount: 0,
      phase: supported.length === 0 ? "done" : "fetching",
      failed: [],
      unsupported: photos.filter((photo) => !takes(photo)),
      cancelled: false,
    };
  }

  /** 低画质版的大小事先不知道，按原片的十分之一估（实测 1080p60 的是 1/20），拿到响应头再校正。 */
  private sizeOf(photo: AlbumPhoto): number {
    return usesProxy(photo, this.quality) ? Math.max(1, Math.round(photo.size_bytes / 10)) : photo.size_bytes;
  }

  get snapshot(): SaveState {
    return { ...this.state, failed: [...this.state.failed] };
  }

  start() {
    this.report(true);
    if (this.state.phase === "fetching") void this.fetchBatch(true);
  }

  cancel() {
    this.ctrl.abort();
    this.files = [];
    this.filePhotos = [];
    this.state.cancelled = true;
    this.state.phase = "done";
    this.report(true);
  }

  /** 用户点「存 N 张到相册」。 */
  share() {
    if (this.state.phase !== "ready" || this.files.length === 0) return;
    this.state.phase = "sharing";
    this.report(true);
    // 不 await 任何东西：share 必须在这次点击里发出去。
    navigator.share({ files: this.files }).then(
      () => this.afterShare(),
      (err: unknown) => {
        if (this.ctrl.signal.aborted) return;
        // 用户关了面板（AbortError）或手势过期（NotAllowedError）：留在「待存」，再点一下就行。
        this.state.phase = "ready";
        if (!(err instanceof DOMException && (err.name === "AbortError" || err.name === "NotAllowedError"))) {
          for (const photo of this.filePhotos) this.state.failed.push({ id: photo.id, filename: photo.filename, error: "系统没能打开保存面板" });
          this.nextBatch();
          return;
        }
        this.report(true);
      },
    );
  }

  private afterShare() {
    if (this.ctrl.signal.aborted) return;
    this.state.saved += this.files.length;
    this.nextBatch();
  }

  private nextBatch() {
    this.files = [];
    this.filePhotos = [];
    this.state.readyCount = 0;
    this.state.batchIndex++;
    if (this.state.batchIndex >= this.batches.length) {
      this.state.phase = "done";
      this.report(true);
      return;
    }
    this.state.phase = "fetching";
    void this.fetchBatch(false);
  }

  private async fetchBatch(first: boolean) {
    const batch = this.batches[this.state.batchIndex];
    const signal = this.ctrl.signal;
    this.state.batchSize = batch.length;
    this.state.batchBytes = batch.reduce((sum, photo) => sum + this.sizeOf(photo), 0);
    this.state.loadedBytes = 0;
    this.report(true);

    let links: Awaited<ReturnType<typeof linksFor>>;
    try {
      links = await linksFor(this.adminKey, batch, this.quality);
    } catch (err) {
      if (signal.aborted) return;
      for (const photo of batch) this.state.failed.push({ id: photo.id, filename: photo.filename, error: errorText(err) });
      this.nextBatch();
      return;
    }

    const files: Array<File | null> = new Array(batch.length).fill(null);
    let cursor = 0;
    const worker = async () => {
      while (!signal.aborted) {
        const index = cursor++;
        if (index >= batch.length) return;
        const photo = batch[index];
        let counted = 0;
        let expected = this.sizeOf(photo);
        try {
          const link = links[photo.id];
          if (!link) throw new RpcError("PHOTO_NOT_FOUND");
          const blob = await fetchBlob(link.url, signal, (bytes) => {
            counted += bytes;
            this.state.loadedBytes += bytes;
            this.report();
          }, (size) => {
            this.state.batchBytes += size - expected;
            expected = size;
          });
          files[index] = new File([blob], link.filename || photo.filename, { type: link.proxy ? "video/mp4" : photo.content_type });
        } catch (err) {
          if (signal.aborted) return;
          this.state.loadedBytes += expected - counted;
          this.state.failed.push({ id: photo.id, filename: photo.filename, error: describe(err) });
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (signal.aborted) return;

    this.filePhotos = batch.filter((_, index) => files[index] !== null);
    this.files = files.filter((file): file is File => file !== null);
    if (this.files.length === 0) {
      this.nextBatch();
      return;
    }
    this.state.readyCount = this.files.length;
    this.state.phase = "ready";
    this.report(true);
    // 第一批要是在手势有效期内就下好了（单张小照片），直接弹面板，省一次点击。
    if (first && Date.now() - this.startedAt < GESTURE_MS) this.share();
  }

  private report(now = false) {
    if (now) {
      if (this.reportTimer) { clearTimeout(this.reportTimer); this.reportTimer = null; }
      this.onChange(this.snapshot);
      return;
    }
    this.reportTimer ??= setTimeout(() => {
      this.reportTimer = null;
      this.onChange(this.snapshot);
    }, 120);
  }
}

async function fetchBlob(
  url: string,
  signal: AbortSignal,
  onBytes: (bytes: number) => void,
  onSize: (bytes: number) => void,
): Promise<Blob> {
  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) throw new RpcError("STORAGE_ERROR");
  const length = Number(res.headers.get("content-length"));
  if (Number.isFinite(length) && length > 0) onSize(length);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    onBytes(value.byteLength);
  }
  return new Blob(chunks as BlobPart[]);
}

function describe(err: unknown): string {
  if (err instanceof RpcError) return errorText(err);
  if (err instanceof RangeError || (err instanceof DOMException && err.name === "QuotaExceededError")) return "文件太大，手机内存不够";
  return errorText(new RpcError("NETWORK"));
}
