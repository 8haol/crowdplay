import { RpcError, errorText } from "../../lib/api";
import { albumSign, forgetUrl, photoUrl } from "./albumApi";
import type { AlbumPhoto } from "./albumTypes";
import { holdUnload } from "./uploadQueue";

/*
 * 视频的低画质版（720p、约 2.5Mbps 的 H.264 MP4，对象 <前缀>proxy.mp4）。
 *
 * 运动相机、无人机的原片动辄 50Mbps 以上，手机网络边下边播跟不上，灯箱里点开要等很久、
 * 播起来一卡一卡。所以另存一份小的，灯箱默认播它，点「原画质」再切原片。
 *
 * 在浏览器里转（WebCodecs，硬件编码），不走服务器：
 * - 上传时跟原片并行。原片卡在网速、转码卡在 CPU，互不抢；原片传完就算这张传好了，
 *   低画质版晚到一会儿，这期间灯箱先播原片。
 * - 老视频、上传时没转成的（关了页面、浏览器不支持），在电脑上点「补生成低画质」，
 *   把原片下回来再转。
 *
 * 转码很吃 CPU 和内存，全局排成一行，一次只转一个。
 * mediabunny 有两百多 KB，只在真要转的时候才加载。
 */

const MAX_EDGE = 1280;
const VIDEO_BITRATE = 2_500_000;
const AUDIO_BITRATE = 128_000;
const MAX_FPS = 30;

export function canMakeProxy(): boolean {
  return typeof VideoEncoder !== "undefined" && typeof VideoDecoder !== "undefined" && typeof AudioEncoder !== "undefined";
}

let support: Promise<boolean> | null = null;

/** 能不能编 H.264 + AAC。第一次调用时加载 mediabunny。 */
export function proxySupported(): Promise<boolean> {
  if (!canMakeProxy()) return Promise.resolve(false);
  support ??= import("mediabunny")
    .then(async ({ canEncodeVideo, canEncodeAudio }) =>
      (await canEncodeVideo("avc", { width: MAX_EDGE, height: 720, bitrate: VIDEO_BITRATE })) &&
      (await canEncodeAudio("aac", { bitrate: AUDIO_BITRATE })))
    .catch(() => false);
  return support;
}

class ProxyError extends Error {}

/** 转一个。视频轨或音轨转不了就整个放弃（没有声音的预览还不如直接播原片）。 */
async function transcode(source: Blob, onProgress: (p: number) => void, signal: AbortSignal): Promise<Blob> {
  const mb = await import("mediabunny");
  const input = new mb.Input({ source: new mb.BlobSource(source), formats: mb.ALL_FORMATS });
  try {
    const target = new mb.BufferTarget();
    const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }), target });
    const conversion = await mb.Conversion.init({
      input,
      output,
      tracks: "primary",
      video: async (track) => {
        const w = track.displayWidth;
        const h = track.displayHeight;
        const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
        const stats = await track.computePacketStats(120).catch(() => null);
        const fast = stats ? stats.averagePacketRate > MAX_FPS + 1 : false;
        return {
          codec: "avc",
          // H.264 要偶数宽高。
          width: Math.max(2, Math.round((w * scale) / 2) * 2),
          height: Math.max(2, Math.round((h * scale) / 2) * 2),
          fit: "fill",
          // 注意 new Quality(数字) 不是码率（实测出来 90Mbps），要写成 { bitrate }。
          quality: new mb.Quality({ bitrate: VIDEO_BITRATE }),
          keyFrameInterval: 2,
          frameRate: fast ? MAX_FPS : undefined,
          forceTranscode: true,
        };
      },
      audio: { codec: "aac", quality: new mb.Quality({ bitrate: AUDIO_BITRATE }), numberOfChannels: 2, forceTranscode: true },
      showWarnings: false,
    });
    const video = conversion.utilizedTracks.some((track) => track.isVideoTrack());
    const hadAudio = (await input.getPrimaryAudioTrack()) !== null;
    const keptAudio = conversion.utilizedTracks.some((track) => track.isAudioTrack());
    if (!conversion.isValid || !video || (hadAudio && !keptAudio)) throw new ProxyError("这个视频的格式浏览器转不了");

    conversion.onProgress = (p) => onProgress(p);
    const abort = () => { void conversion.cancel(); };
    signal.addEventListener("abort", abort, { once: true });
    try {
      await conversion.execute();
    } finally {
      signal.removeEventListener("abort", abort);
    }
    if (!target.buffer) throw new ProxyError("转码没有产出文件");
    return new Blob([target.buffer], { type: "video/mp4" });
  } finally {
    input.dispose();
  }
}

/* ------------------------------------------------------------ 队列 */

export type ProxyStatus = "queued" | "loading" | "converting" | "waiting" | "uploading" | "done" | "failed";

export interface ProxyItemView {
  id: string;
  albumId: string;
  name: string;
  status: ProxyStatus;
  /** 当前这一步的进度，0–1。 */
  progress: number;
  error: string | null;
}

interface Job extends ProxyItemView {
  adminKey: string;
  /** 原片从哪来：上传时是手里的 File，补生成时从 R2 下回来。 */
  source: () => Promise<Blob>;
  /** 上传时原片还没 complete，拿不到能签 proxy 的 photo id；complete 之后才 resolve。 */
  photoId: Promise<string>;
  resolvePhoto: (id: string) => void;
  ctrl: AbortController;
  /** 补生成时知道的照片 id；上传的在 attach 之后才有。 */
  knownPhotoId: string | null;
}

export interface ProxySnapshot {
  items: ProxyItemView[];
}

export interface UploadProxyHandle {
  /** 原片 complete 了：可以传低画质版了。 */
  attach(photoId: string): void;
  cancel(): void;
}

let nextId = 1;

class ProxyQueue {
  private jobs: Job[] = [];
  private running = false;
  private listeners = new Set<() => void>();
  private readyListeners = new Set<(photoId: string) => void>();
  private snapshot: ProxySnapshot = { items: [] };
  private emitTimer: ReturnType<typeof setTimeout> | null = null;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = () => this.snapshot;

  /** 某张视频的低画质版传好了。 */
  onReady(listener: (photoId: string) => void) {
    this.readyListeners.add(listener);
    return () => { this.readyListeners.delete(listener); };
  }

  /** 上传一个视频时调：马上开始转，原片 complete 后再 attach。 */
  fromUpload(adminKey: string, albumId: string, file: File): UploadProxyHandle {
    const job = this.push(adminKey, albumId, file.name, () => Promise.resolve(file), null);
    return {
      attach: (photoId) => { job.knownPhotoId = photoId; job.resolvePhoto(photoId); },
      cancel: () => this.cancel(job),
    };
  }

  /** 补生成：已经在相册里、还没有低画质版的视频。已经在队列里的跳过。 */
  backfill(adminKey: string, albumId: string, photos: AlbumPhoto[]) {
    for (const photo of photos) {
      const queued = this.jobs.some((job) => job.knownPhotoId === photo.id && job.status !== "failed" && job.status !== "done");
      if (queued) continue;
      this.jobs = this.jobs.filter((job) => job.knownPhotoId !== photo.id);
      this.push(adminKey, albumId, photo.filename, () => fetchOriginal(adminKey, photo), photo.id);
    }
  }

  retryFailed(albumId: string) {
    for (const job of this.jobs) {
      if (job.albumId !== albumId || job.status !== "failed" || !job.knownPhotoId) continue;
      job.status = "queued";
      job.error = null;
      job.progress = 0;
      job.ctrl = new AbortController();
    }
    this.pump();
    this.emit(true);
  }

  cancelAlbum(albumId: string) {
    for (const job of [...this.jobs]) if (job.albumId === albumId && isActive(job.status)) this.cancel(job);
  }

  clearFinished(albumId: string) {
    this.jobs = this.jobs.filter((job) => job.albumId !== albumId || isActive(job.status));
    this.emit(true);
  }

  private push(adminKey: string, albumId: string, name: string, source: () => Promise<Blob>, photoId: string | null): Job {
    let resolvePhoto!: (id: string) => void;
    const promise = photoId ? Promise.resolve(photoId) : new Promise<string>((resolve) => { resolvePhoto = resolve; });
    const job: Job = {
      id: String(nextId++),
      albumId,
      name,
      status: "queued",
      progress: 0,
      error: null,
      adminKey,
      source,
      photoId: promise,
      resolvePhoto: resolvePhoto ?? (() => undefined),
      ctrl: new AbortController(),
      knownPhotoId: photoId,
    };
    this.jobs.push(job);
    this.pump();
    this.emit(true);
    return job;
  }

  private cancel(job: Job) {
    job.ctrl.abort();
    this.jobs = this.jobs.filter((entry) => entry !== job);
    this.emit(true);
  }

  /** 转码一次只跑一个；转完的传低画质版不占这个名额（可能还在等原片传完）。 */
  private pump() {
    holdUnload(this, this.jobs.some((job) => isActive(job.status)));
    if (this.running) return;
    const next = this.jobs.find((job) => job.status === "queued");
    if (!next) return;
    this.running = true;
    void this.convert(next).then((proxy) => {
      this.running = false;
      if (proxy) void this.upload(next, proxy);
      this.pump();
      this.emit(true);
    });
  }

  private async convert(job: Job): Promise<Blob | null> {
    const { signal } = job.ctrl;
    try {
      // 浏览器编不了 H.264 / AAC：静静地拿掉，灯箱照旧播原片。
      if (!(await proxySupported())) {
        this.jobs = this.jobs.filter((entry) => entry !== job);
        return null;
      }
      job.status = "loading";
      job.progress = 0;
      this.emit(true);
      const source = await job.source();
      if (signal.aborted) return null;

      job.status = "converting";
      this.emit(true);
      const proxy = await transcode(source, (p) => { job.progress = p; this.emit(false); }, signal);
      if (signal.aborted) return null;
      job.status = "waiting";
      job.progress = 0;
      return proxy;
    } catch (err) {
      this.fail(job, err);
      return null;
    }
  }

  private async upload(job: Job, proxy: Blob) {
    const { signal } = job.ctrl;
    try {
      const photoId = await job.photoId;
      if (signal.aborted) return;
      job.status = "uploading";
      this.emit(true);
      const { put_proxy } = await albumSign<{ put_proxy: string }>("proxy_upload", { admin_key: job.adminKey, photo_id: photoId });
      const res = await fetch(put_proxy, { method: "PUT", headers: { "content-type": "video/mp4" }, body: proxy, signal });
      if (!res.ok) throw new RpcError("STORAGE_ERROR");
      await albumSign("proxy_done", { admin_key: job.adminKey, photo_id: photoId });
      job.status = "done";
      job.progress = 1;
      forgetUrl("proxy", photoId);
      for (const listener of this.readyListeners) listener(photoId);
    } catch (err) {
      this.fail(job, err);
    } finally {
      this.pump();
      this.emit(true);
    }
  }

  private fail(job: Job, err: unknown) {
    if (job.ctrl.signal.aborted) return;
    job.status = "failed";
    job.error = err instanceof ProxyError ? err.message : errorText(err instanceof RpcError ? err : new RpcError("NETWORK"));
  }

  private emit(now: boolean) {
    if (now) {
      if (this.emitTimer) { clearTimeout(this.emitTimer); this.emitTimer = null; }
      this.publish();
      return;
    }
    this.emitTimer ??= setTimeout(() => { this.emitTimer = null; this.publish(); }, 200);
  }

  private publish() {
    this.snapshot = {
      items: this.jobs.map(({ id, albumId, name, status, progress, error }) => ({ id, albumId, name, status, progress, error })),
    };
    holdUnload(this, this.jobs.some((job) => isActive(job.status)));
    for (const listener of this.listeners) listener();
  }
}

function isActive(status: ProxyStatus) {
  return status !== "done" && status !== "failed";
}

async function fetchOriginal(adminKey: string, photo: AlbumPhoto): Promise<Blob> {
  const url = await photoUrl(adminKey, photo, "original");
  if (!url) throw new RpcError("PHOTO_NOT_FOUND");
  const res = await fetch(url);
  if (!res.ok) throw new RpcError("STORAGE_ERROR");
  return res.blob();
}

export const proxyQueue = new ProxyQueue();
