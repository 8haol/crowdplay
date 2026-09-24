/*
 * 浏览器端生成两张小图：缩略图（长边 400，网格用）和预览图（长边 2048，灯箱用）。
 * 服务端不转码，所以这一步决定了网格和灯箱能不能顺滑。
 *
 * - 图片：createImageBitmap(file, { imageOrientation: "from-image" }) 按 EXIF 方向摆正；
 *   它不认识的格式（Chrome 里的 HEIC）再试一次 <img> 解码（Safari 能解 HEIC）。
 * - 视频：离屏 <video> 跳到 1 秒（短于 2 秒的取中间）抓一帧。
 * - 原图比目标小就不放大。JPEG 0.82。
 * - 任何一步失败都返回 null，不阻塞上传：没有小图的文件在网格里显示类型图标。
 *
 * 解码一张 5000 万像素的照片要占两三百 MB 内存，上传并发 3 的时候不能让三张同时解，
 * 所以这里用一条 Promise 链把生成排成单行。
 */
const THUMB_EDGE = 400;
const PREVIEW_EDGE = 2048;
const QUALITY = 0.82;
const TIMEOUT_MS = 30_000;

export interface Thumbs {
  thumb: Blob | null;
  preview: Blob | null;
}

const EMPTY: Thumbs = { thumb: null, preview: null };

interface Source {
  image: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

let chain: Promise<unknown> = Promise.resolve();

export function makeThumbs(file: File, contentType: string): Promise<Thumbs> {
  const run = () => withTimeout(generate(file, contentType)).catch(() => EMPTY);
  const next = chain.then(run, run);
  chain = next;
  return next;
}

function withTimeout(work: Promise<Thumbs>): Promise<Thumbs> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(EMPTY), TIMEOUT_MS);
    work.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(EMPTY); },
    );
  });
}

async function generate(file: File, contentType: string): Promise<Thumbs> {
  const source = contentType.startsWith("video/") ? await videoFrame(file) : await imageSource(file);
  if (!source || source.width <= 0 || source.height <= 0) {
    source?.release();
    return EMPTY;
  }
  try {
    const preview = scale(source.image, source.width, source.height, PREVIEW_EDGE);
    // 缩略图从预览图再缩：2048 → 400 比从几千像素一步缩到 400 更清楚，也更快。
    const thumb = scale(preview, preview.width, preview.height, THUMB_EDGE);
    const result = { preview: await toJpeg(preview), thumb: await toJpeg(thumb) };
    preview.width = 0;
    thumb.width = 0;
    return result;
  } finally {
    source.release();
  }
}

async function imageSource(file: File): Promise<Source | null> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { image: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // 这个格式 createImageBitmap 不认识，下面再给 <img> 一次机会
    }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  try {
    await img.decode();
    return { image: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

function videoFrame(file: File): Promise<Source | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;
    const cleanup = () => {
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    };
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!ok || video.videoWidth === 0) {
        cleanup();
        resolve(null);
        return;
      }
      resolve({ image: video, width: video.videoWidth, height: video.videoHeight, release: cleanup });
    };
    const timer = setTimeout(() => finish(false), 15_000);
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.onloadedmetadata = () => {
      const duration = video.duration;
      video.currentTime = Number.isFinite(duration) && duration > 0 ? Math.min(1, duration / 2) : 1;
    };
    video.onseeked = () => finish(true);
    video.onerror = () => finish(false);
    video.src = url;
  });
}

function scale(image: CanvasImageSource, width: number, height: number, edge: number): HTMLCanvasElement {
  const ratio = Math.min(1, edge / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("NO_CANVAS");
  // 透明 PNG 转 JPEG 会变黑底；先铺一层纸色。
  ctx.fillStyle = paperColor();
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function toJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/jpeg", QUALITY));
}

let paper: string | null = null;
function paperColor(): string {
  if (paper === null) {
    paper = getComputedStyle(document.documentElement).getPropertyValue("--color-card").trim() || "white";
  }
  return paper;
}
