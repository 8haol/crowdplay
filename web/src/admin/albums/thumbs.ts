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
 * 解码一张 5000 万像素的照片要占两三百 MB 内存，上传并发的时候不能让几张同时解，
 * 所以这里用一条 Promise 链把生成排成单行。
 *
 * 2026-09-25 园游会 687 张 2400 万像素 JPEG 上传时踩过的坑（Chrome 最后崩了）：
 * - 整张解码 6000×4000 占 96MB，画布又走 GPU，显存一紧就画出一整块灰，照样被当成缩略图传上去。
 *   现在先读 JPEG 头拿到宽高和 EXIF 方向，让 createImageBitmap 直接解成 2048 长边（libjpeg 按 DCT
 *   缩放解码，快而且只占十几 MB）；画布用 willReadFrequently 走 CPU，不碰显存。
 * - 超时只是不再等它，解码本身还在跑；以前链条在超时那一刻就放下一张进来，慢了一张之后几张大图
 *   叠在一起解，内存雪崩。现在链条等真正做完（或确定失败）才放下一张。
 * - 画出来几乎是纯色的当作失败，宁可没有缩略图（网格显示文件名），也不传一张灰块。
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
  let work: Promise<Thumbs> | null = null;
  const run = () => (work = generate(file, contentType).catch(() => EMPTY));
  // 链条挂在真正的工作上，不挂在超时上：超时的那张解完之前，下一张不许开始。
  const done = chain.then(run, run);
  chain = done;
  return withTimeout(done.then(() => work ?? EMPTY), TIMEOUT_MS);
}

function withTimeout(work: Promise<Thumbs>, ms: number): Promise<Thumbs> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    // 计时从轮到这张开始算不公平——排队等前面的也算进去了；但排队时间有上限（前面每张最多 ms），
    // 而调用方要的只是「别永远等下去」，所以给足四倍。
    timer = setTimeout(() => resolve(EMPTY), ms * 4);
    work.then(
      (value) => { if (timer) clearTimeout(timer); resolve(value); },
      () => { if (timer) clearTimeout(timer); resolve(EMPTY); },
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
    if (looksBlank(thumb)) {
      preview.width = 0;
      thumb.width = 0;
      return EMPTY;
    }
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
      const bitmap = await createImageBitmap(file, await decodeOptions(file));
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

/**
 * 让 createImageBitmap 直接解成预览图大小。resizeWidth / resizeHeight 作用在摆正之后的图上，
 * 所以 EXIF 方向 5–8（转了 90°）要把宽高对调再算。读不到头就整张解，和以前一样。
 */
async function decodeOptions(file: File): Promise<ImageBitmapOptions> {
  const options: ImageBitmapOptions = { imageOrientation: "from-image" };
  const geometry = await jpegGeometry(file);
  if (!geometry) return options;
  const turned = geometry.orientation >= 5 && geometry.orientation <= 8;
  const width = turned ? geometry.height : geometry.width;
  const height = turned ? geometry.width : geometry.height;
  const ratio = PREVIEW_EDGE / Math.max(width, height);
  if (ratio >= 1) return options;
  options.resizeWidth = Math.max(1, Math.round(width * ratio));
  options.resizeHeight = Math.max(1, Math.round(height * ratio));
  options.resizeQuality = "high";
  return options;
}

const GEOMETRY_BYTES = 512 * 1024;

/** JPEG 头里的宽高（SOF 段）和 EXIF 方向（IFD0 的 0x0112）。不是 JPEG 或读不到就返回 null。 */
async function jpegGeometry(file: Blob): Promise<{ width: number; height: number; orientation: number } | null> {
  try {
    const view = new DataView(await file.slice(0, GEOMETRY_BYTES).arrayBuffer());
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;
    let orientation = 1;
    let offset = 2;
    while (offset + 9 <= view.byteLength) {
      if (view.getUint8(offset) !== 0xff) return null;
      const marker = view.getUint8(offset + 1);
      if (marker === 0xff) { offset += 1; continue; }
      if (marker === 0xda || marker === 0xd9) return null;
      const length = view.getUint16(offset + 2);
      if (marker === 0xe1 && view.getUint32(offset + 4) === 0x45786966) {
        orientation = exifOrientation(view, offset + 10) ?? orientation;
      }
      // SOF0–SOF15，除去 DHT(C4)、JPG(C8)、DAC(CC)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = view.getUint16(offset + 5);
        const width = view.getUint16(offset + 7);
        return width > 0 && height > 0 ? { width, height, orientation } : null;
      }
      offset += 2 + length;
    }
    return null;
  } catch {
    return null;
  }
}

function exifOrientation(view: DataView, start: number): number | null {
  const order = view.getUint16(start);
  if (order !== 0x4949 && order !== 0x4d4d) return null;
  const little = order === 0x4949;
  const ifd0 = start + view.getUint32(start + 4, little);
  const count = view.getUint16(ifd0, little);
  for (let i = 0; i < count; i++) {
    const entry = ifd0 + 2 + i * 12;
    if (view.getUint16(entry, little) === 0x0112) {
      const value = view.getUint16(entry + 8, little);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

/** 缩略图几乎是纯色 = 解码或绘制失败了（显存不足时 Chrome 会画出一整块灰）。 */
function looksBlank(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return true;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let min = 255;
  let max = 0;
  // 隔 16 个像素取一次亮度就够判断「整张一个颜色」。
  for (let i = 0; i < data.length; i += 64) {
    const luma = (data[i] * 3 + data[i + 1] * 6 + data[i + 2]) / 10;
    if (luma < min) min = luma;
    if (luma > max) max = luma;
  }
  return max - min < 6;
}

function scale(image: CanvasImageSource, width: number, height: number, edge: number): HTMLCanvasElement {
  const ratio = Math.min(1, edge / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  // willReadFrequently 让 Chrome 用 CPU 画布：几百张大图连着画，GPU 显存扛不住。
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
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
