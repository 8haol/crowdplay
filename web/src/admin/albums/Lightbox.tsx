/*
 * 活动相册灯箱（设计 7.5）。只管「看」：取 URL、爱心、下载都交回调用方。
 *
 * 顺滑的几个关键：
 * - 先把缓存的缩略图拉伸铺满，预览图 decode() 完再 150ms 交叉淡入，不闪白。
 * - 手势全部走 pointer events，拖动时直接写 transform（translate3d），不经过 React 渲染。
 * - 只挂当前 ±1 张的大图 DOM；预览图预加载前后各 2 张（停下来 120ms 再预加载，连翻时不白要）。
 * - 翻页动画还没走完又来一次翻页（按住方向键、连点）：不等动画，直接换到下一张。
 *
 * 界面照 Google Photos：照片铺满，顶栏（返回、文件名、爱心、下载、信息）和左右翻页键浮在上面，
 * 鼠标 3 秒不动就淡出；手机上单击切换显示，翻页靠滑动。胶片条默认收起，从顶栏打开。
 */
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  type SyntheticEvent,
} from "react";
import { createPortal } from "react-dom";
import { AdminIcon } from "../adminUi";
import { isVideo, type AlbumPhoto, type LightboxProps, type ViewKind } from "./albumTypes";
import { fullDateTime, shortDateTime } from "./albumView";

const GAP = 24; // 相邻两张之间的缝，翻页时能看见一条黑边
const PAGE_MS = 240;
const SNAP_MS = 220;
const FADE_MS = 150;
const ZOOM_MS = 220;
const ZOOM_MAX = 2.5;
const SLOP = 8; // 手指移动超过这个距离才算拖动，决定方向
const PAGE_FRACTION = 0.3;
const FLICK_SPEED = 0.5; // px/ms
const DISMISS_PX = 120;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 30;
const TAP_MS = 250;
const VIDEO_CONTROLS_PX = 72; // 视频底部控件条区域不接手势，留给原生进度条
const PRELOAD = 2;
const PRELOAD_DELAY_MS = 120;
const VELOCITY_WINDOW_MS = 100;
const CHROME_IDLE_MS = 3000; // 鼠标不动这么久，控件淡出
const REPEAT_MS = 70; // 按住方向键时最快这么翻一张
const STRIP_H = 64;

const INK = "var(--color-card)";
const INK_DIM = "color-mix(in oklab, var(--color-card) 68%, transparent)";
const CHIP = "color-mix(in oklab, var(--color-card) 14%, transparent)";
const BLOCK = "color-mix(in oklab, var(--color-card) 10%, transparent)";
const BACKDROP = "var(--color-admin-rail-line)";
const NAV_BG = "color-mix(in oklab, var(--color-admin-rail-line) 58%, transparent)";
const SCRIM_TOP = "linear-gradient(to bottom, color-mix(in oklab, var(--color-admin-rail-line) 62%, transparent), transparent)";
const PANEL_BG = "var(--color-admin-rail)";
const LIKED = "var(--color-seal-deep)";
const EASE = "var(--ease-out-expo)";

const finePointer = () => typeof window !== "undefined" && !!window.matchMedia?.("(pointer: fine)").matches;

type Zoom = { s: number; tx: number; ty: number };
const IDENTITY: Zoom = { s: 1, tx: 0, ty: 0 };

type Gesture =
  | { k: "idle" }
  | { k: "wait" } // 手势作废，等所有手指抬起
  | { k: "press"; id: number; x0: number; y0: number; t0: number }
  | { k: "swipe"; id: number; x0: number; y0: number }
  | { k: "dismiss"; id: number; x0: number; y0: number }
  | { k: "pan"; id: number; x0: number; y0: number; tx0: number; ty0: number }
  | { k: "pinch"; d0: number; s0: number; tx0: number; ty0: number };

type Sample = { t: number; x: number; y: number };
type GetUrl = LightboxProps["getUrl"];

/* ---------------------------------------------------------------- loader */

interface Loader {
  /** 已经 decode 完的预览图 URL，同步读，二次进入同一张时直接显示不淡入。 */
  decoded: Map<string, string>;
  /** 图片宽高比，用来算放大后拖动的边界。 */
  aspects: Map<string, number>;
  preview: (photo: AlbumPhoto, getUrl: GetUrl) => Promise<string | null>;
  thumb: (photo: AlbumPhoto, getUrl: GetUrl) => Promise<string | null>;
  original: (photo: AlbumPhoto, getUrl: GetUrl) => Promise<string | null>;
  /** 视频的低画质版；没有就 null。 */
  proxy: (photo: AlbumPhoto, getUrl: GetUrl) => Promise<string | null>;
  /** 只留住窗口内的已解码 Image 对象，其余交给浏览器回收。 */
  retain: (ids: Set<string>) => void;
}

function decodeImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  const viaLoad = () =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      if (img.complete) {
        if (img.naturalWidth > 0) resolve(img);
        else reject(new Error("image failed"));
        return;
      }
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("image failed"));
    });
  if (typeof img.decode !== "function") return viaLoad();
  return img.decode().then(() => img, viaLoad);
}

/** 调用方每次把当下的 getUrl 传进来；这里只负责去重、decode 和留住解码结果。 */
function createLoader(): Loader {
  const decoded = new Map<string, string>();
  const aspects = new Map<string, number>();
  const held = new Map<string, HTMLImageElement>();
  const previews = new Map<string, Promise<string | null>>();
  const safeGet = (getUrl: GetUrl, photo: AlbumPhoto, kind: ViewKind) =>
    Promise.resolve()
      .then(() => getUrl(photo, kind))
      .catch(() => null);

  return {
    decoded,
    aspects,
    preview(photo, getUrl) {
      if (isVideo(photo) || !photo.has_preview) return Promise.resolve(null);
      const hit = previews.get(photo.id);
      if (hit) return hit;
      const job = safeGet(getUrl, photo, "preview").then((url) =>
        url
          ? decodeImage(url).then(
              (img) => {
                held.set(photo.id, img);
                decoded.set(photo.id, url);
                if (img.naturalWidth && img.naturalHeight) aspects.set(photo.id, img.naturalWidth / img.naturalHeight);
                return url;
              },
              () => null,
            )
          : null,
      );
      previews.set(photo.id, job);
      return job;
    },
    thumb: (photo, getUrl) => (photo.has_thumb ? safeGet(getUrl, photo, "thumb") : Promise.resolve(null)),
    original: (photo, getUrl) => safeGet(getUrl, photo, "original"),
    proxy: (photo, getUrl) => (photo.has_proxy ? safeGet(getUrl, photo, "proxy") : Promise.resolve(null)),
    retain(ids) {
      for (const id of [...held.keys()]) if (!ids.has(id)) held.delete(id);
    },
  };
}

/* --------------------------------------------------------------- helpers */

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

/** iOS 式橡皮筋：越拉越拉不动。 */
function rubber(offset: number, dimension: number) {
  const d = Math.max(1, dimension);
  return Math.sign(offset) * (1 - 1 / ((Math.abs(offset) * 0.55) / d + 1)) * d;
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 10 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

function fileKind(photo: AlbumPhoto) {
  const dot = photo.filename.lastIndexOf(".");
  if (dot > 0 && dot < photo.filename.length - 1) return photo.filename.slice(dot + 1).slice(0, 5);
  return photo.content_type.split("/")[1]?.slice(0, 5) || "文件";
}

function useReducedMotion() {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduce, setReduce] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const onChange = () => setReduce(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduce;
}

function setOpacity(els: (HTMLElement | null)[], value: number, ms: number) {
  for (const el of els) {
    if (!el) continue;
    el.style.transition = ms ? `opacity ${ms}ms ${EASE}` : "none";
    el.style.opacity = String(value);
  }
}

/* ----------------------------------------------------------------- icons */

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
    </svg>
  );
}

function PlayBadge({ small = false }: { small?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 m-auto grid place-items-center rounded-full ${small ? "h-5 w-5" : "h-16 w-16"}`}
      style={{ background: "color-mix(in oklab, var(--color-admin-rail-line) 60%, transparent)", color: INK }}
    >
      <svg viewBox="0 0 24 24" className={small ? "h-2.5 w-2.5" : "h-7 w-7"} fill="currentColor">
        <path d="M8 5.5v13l10.5-6.5Z" />
      </svg>
    </span>
  );
}

/* ----------------------------------------------------------------- slide */

function FilePlaceholder({ photo }: { photo: AlbumPhoto }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
      <div className="grid h-20 w-20 place-items-center rounded-2xl text-sm font-black uppercase" style={{ background: CHIP, color: INK_DIM }}>
        {fileKind(photo)}
      </div>
      <p className="max-w-full truncate text-sm font-bold" style={{ color: INK }}>{photo.filename}</p>
      <p className="tabular text-xs font-bold" style={{ color: INK_DIM }}>{formatBytes(photo.size_bytes)}</p>
    </div>
  );
}

const fill = "absolute inset-0 h-full w-full object-contain";

function Slide({
  photo,
  offset,
  active,
  loader,
  getUrl,
  cachedThumb,
  reduce,
  zoomRef,
  videoRef,
  onVideoPlay,
  original,
}: {
  photo: AlbumPhoto;
  offset: number;
  active: boolean;
  loader: Loader;
  getUrl: GetUrl;
  cachedThumb: LightboxProps["cachedThumb"];
  reduce: boolean;
  zoomRef: (el: HTMLDivElement | null) => void;
  videoRef: RefObject<HTMLVideoElement | null>;
  onVideoPlay: () => void;
  /** 用户点了「原画质」：播原片而不是低画质版。 */
  original: boolean;
}) {
  const video = isVideo(photo);
  const syncThumb = cachedThumb(photo);
  const [asyncThumb, setAsyncThumb] = useState<string | null | undefined>(undefined);
  const thumb = syncThumb ?? asyncThumb ?? null;
  const thumbDone = !!syncThumb || !photo.has_thumb || asyncThumb !== undefined;

  const [preview, setPreview] = useState<string | null>(() => loader.decoded.get(photo.id) ?? null);
  const [previewDone, setPreviewDone] = useState(() => video || !photo.has_preview || loader.decoded.has(photo.id));
  const [thumbHidden, setThumbHidden] = useState(() => loader.decoded.has(photo.id));
  const previewAtMount = useRef(preview !== null);
  const previewImg = useRef<HTMLImageElement>(null);

  // 默认播低画质版（有的话）；点了「原画质」换原片，从刚才播到的地方接着播。
  const videoKind = original || !photo.has_proxy ? "original" : "proxy";
  const [videoSrc, setVideoSrc] = useState<{ kind: string; url: string | null } | null>(null);
  // 换画质时新地址到手之前，先接着放旧的。
  const videoUrl = videoSrc === null ? undefined : videoSrc.url;
  const resumeAt = useRef<{ time: number; play: boolean } | null>(null);

  // 没有同步缩略图时再异步要一次（调用方有缓存，基本是立刻返回）。
  useEffect(() => {
    if (syncThumb || !photo.has_thumb) return;
    let alive = true;
    void loader.thumb(photo, getUrl).then((url) => {
      if (alive) setAsyncThumb(url);
    });
    return () => {
      alive = false;
    };
  }, [photo, syncThumb, loader, getUrl]);

  useEffect(() => {
    if (video || preview) return;
    let alive = true;
    void loader.preview(photo, getUrl).then((url) => {
      if (!alive) return;
      if (url) setPreview(url);
      setPreviewDone(true);
    });
    return () => {
      alive = false;
    };
  }, [photo, video, preview, loader, getUrl]);

  // 预览图已 decode，挂上去的第一帧就从 0 淡到 1，淡完再撤掉底下的缩略图。
  useLayoutEffect(() => {
    if (!preview) return;
    const el = previewImg.current;
    if (!el || previewAtMount.current || reduce || typeof el.animate !== "function") {
      setThumbHidden(true);
      return;
    }
    const anim = el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: "ease-out" });
    anim.onfinish = () => setThumbHidden(true);
    return () => anim.cancel();
  }, [preview, reduce]);

  useEffect(() => {
    if (!video || !active || videoSrc?.kind === videoKind) return;
    let alive = true;
    const el = videoRef.current;
    if (videoSrc && el) resumeAt.current = { time: el.currentTime, play: !el.paused };
    const load = videoKind === "proxy"
      // 低画质版签不出来（比如刚补生成、缓存还是旧的）就退回原片。
      ? loader.proxy(photo, getUrl).then((url) => url ?? loader.original(photo, getUrl))
      : loader.original(photo, getUrl);
    void load.then((url) => {
      if (alive) setVideoSrc({ kind: videoKind, url });
    });
    return () => {
      alive = false;
    };
  }, [photo, video, active, videoKind, videoSrc, loader, getUrl, videoRef]);

  const onLoadedMetadata = (e: SyntheticEvent<HTMLVideoElement>) => {
    const resume = resumeAt.current;
    resumeAt.current = null;
    if (!resume) return;
    const el = e.currentTarget;
    el.currentTime = resume.time;
    if (resume.play) void el.play().catch(() => undefined);
  };

  const rememberAspect = (img: HTMLImageElement) => {
    if (!loader.aspects.has(photo.id) && img.naturalWidth && img.naturalHeight) {
      loader.aspects.set(photo.id, img.naturalWidth / img.naturalHeight);
    }
  };

  let body: ReactNode;
  if (video) {
    if (active && videoUrl) {
      body = (
        <video
          ref={videoRef}
          className={fill}
          src={videoUrl}
          poster={thumb ?? undefined}
          controls
          playsInline
          preload="metadata"
          aria-label={photo.filename}
          onPlay={onVideoPlay}
          onLoadedMetadata={onLoadedMetadata}
        />
      );
    } else if (thumb) {
      body = (
        <>
          <img src={thumb} alt="" className={fill} draggable={false} />
          <PlayBadge />
        </>
      );
    } else if (active && videoUrl === null) {
      body = <FilePlaceholder photo={photo} />;
    } else {
      body = thumbDone ? <FilePlaceholder photo={photo} /> : null;
    }
  } else {
    body = (
      <>
        {thumb && !thumbHidden && (
          <img src={thumb} alt={preview ? "" : photo.filename} className={fill} draggable={false} onLoad={(e) => rememberAspect(e.currentTarget)} />
        )}
        {preview && (
          <img ref={previewImg} src={preview} alt={photo.filename} className={fill} draggable={false} onLoad={(e) => rememberAspect(e.currentTarget)} />
        )}
        {!thumb && !preview && thumbDone && previewDone && <FilePlaceholder photo={photo} />}
      </>
    );
  }

  return (
    <div
      className="absolute inset-0"
      style={{ transform: `translate3d(calc(${offset} * (100% + ${GAP}px)), 0, 0)` }}
      aria-hidden={!active}
    >
      <div ref={active ? zoomRef : undefined} className="absolute inset-0" style={{ transformOrigin: "50% 50%", willChange: active ? "transform" : undefined }}>
        {body}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- filmstrip */

const FilmStrip = memo(function FilmStrip({
  photos,
  index,
  cachedThumb,
  reduce,
  onSelect,
}: {
  photos: AlbumPhoto[];
  index: number;
  cachedThumb: LightboxProps["cachedThumb"];
  reduce: boolean;
  onSelect: (i: number) => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const first = useRef(true);

  useEffect(() => {
    const center = (smooth: boolean) => {
      const strip = stripRef.current;
      const item = strip?.querySelector<HTMLElement>(`[data-i="${index}"]`);
      if (!strip || !item) return;
      const left = item.offsetLeft - (strip.clientWidth - item.offsetWidth) / 2;
      strip.scrollTo({ left, behavior: smooth ? "smooth" : "auto" });
    };
    center(!first.current && !reduce);
    first.current = false;
    const onResize = () => center(false);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [index, reduce]);

  return (
    <div
      ref={stripRef}
      role="group"
      aria-label="胶片条"
      className="relative flex gap-1.5 overflow-x-auto px-4 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{ touchAction: "pan-x", overscrollBehaviorX: "contain" }}
    >
      {photos.map((p, i) => {
        const src = cachedThumb(p);
        const current = i === index;
        return (
          <button
            key={p.id}
            type="button"
            data-i={i}
            onClick={() => onSelect(i)}
            aria-label={`第 ${i + 1} 张`}
            aria-current={current ? "true" : undefined}
            className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md transition-opacity duration-150 motion-reduce:transition-none"
            style={{
              background: BLOCK,
              opacity: current ? 1 : 0.55,
            }}
          >
            {src && <img src={src} alt="" loading="lazy" decoding="async" draggable={false} className="pointer-events-none h-full w-full object-cover" />}
            {isVideo(p) && <PlayBadge small />}
            {current && <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-md" style={{ boxShadow: `inset 0 0 0 2px ${INK}` }} />}
          </button>
        );
      })}
    </div>
  );
});

/* -------------------------------------------------------------- lightbox */

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-black tracking-[0.08em]" style={{ color: INK_DIM }}>{label}</dt>
      <dd className="mt-1 break-all text-sm font-bold">{children}</dd>
    </div>
  );
}

export function Lightbox(props: LightboxProps) {
  const { photos, onIndexChange, onClose, getUrl, cachedThumb, onToggleLike, onDownload } = props;
  const count = photos.length;
  const index = count ? clamp(Math.round(props.index), 0, count - 1) : 0;
  const photo: AlbumPhoto | undefined = photos[index];
  const reduce = useReducedMotion();

  const [loader] = useState(createLoader);
  // 顶栏、翻页键、胶片条是否显示。鼠标 3 秒不动就藏起来，手机上单击切换。
  const [chrome, setChrome] = useState(true);
  const [info, setInfo] = useState(false);
  // 胶片条每次打开都展开（手机也是）；收起只管这一次，不记住。
  const [strip, setStrip] = useState(true);
  // 这次打开灯箱里点过「原画质」的视频。
  const [originals, setOriginals] = useState<ReadonlySet<string>>(() => new Set());

  const latest = useRef({ index, count, photo, reduce, info, onIndexChange, onClose });
  useLayoutEffect(() => {
    latest.current = { index, count, photo, reduce, info, onIndexChange, onClose };
  });

  const rootRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const zoomElRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const zoomRef = useRef<Zoom>(IDENTITY);
  // 记下是哪一张放大了，换张后自然就是「没放大」，不用在 effect 里重置。
  const [zoomedId, setZoomedId] = useState<string | null>(null);
  const zoomed = !!photo && zoomedId === photo.id;
  const animatingRef = useRef(false);
  // 已经要求调用方换到、但调用方还没换过来的那一张。连着翻页时从它往后数，而不是从旧的 index。
  const wantRef = useRef<number | null>(null);
  const lastRepeat = useRef(0);
  const timers = useRef<number[]>([]);
  const gesture = useRef<Gesture>({ k: "idle" });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const samples = useRef<Sample[]>([]);
  const lastTap = useRef<Sample | null>(null);
  const tapTimer = useRef<number | undefined>(undefined);
  const hideTimer = useRef<number | undefined>(undefined);
  const overControls = useRef(false);

  /* -------------------------------------------------------------- chrome */

  const scheduleHide = useCallback(() => {
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      // 鼠标停在按钮上、或信息栏开着的时候不藏。
      if (overControls.current || latest.current.info) return;
      setChrome(false);
    }, CHROME_IDLE_MS);
  }, []);

  const showChrome = useCallback((autoHide: boolean) => {
    setChrome(true);
    if (autoHide) scheduleHide();
    else window.clearTimeout(hideTimer.current);
  }, [scheduleHide]);

  const toggleChrome = useCallback(() => {
    window.clearTimeout(hideTimer.current);
    setChrome((value) => !value);
  }, []);

  useEffect(() => {
    if (finePointer()) scheduleHide();
    return () => {
      window.clearTimeout(hideTimer.current);
      window.clearTimeout(tapTimer.current);
    };
  }, [scheduleHide]);

  const onMouseActivity = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse") return;
    overControls.current = !!(e.target as Element).closest("[data-controls]");
    showChrome(true);
  };

  /* -------------------------------------------------------------- paging */

  const clearTimers = useCallback(() => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
  }, []);

  const resetTrack = useCallback(() => {
    const track = trackRef.current;
    if (track) {
      track.style.transition = "none";
      track.style.transform = "translate3d(0, 0, 0)";
    }
    animatingRef.current = false;
  }, []);

  /** 当前张换人时，把上一张残留的缩放/缩小清掉。 */
  const setZoomEl = useCallback((el: HTMLDivElement | null) => {
    const prev = zoomElRef.current;
    if (prev && prev !== el) {
      prev.style.transition = "none";
      prev.style.transform = "";
    }
    zoomElRef.current = el;
  }, []);

  const clampZoom = useCallback(
    (z: Zoom): Zoom => {
      const stage = stageRef.current;
      const current = latest.current.photo;
      if (!stage || !current) return IDENTITY;
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      const aspect = loader.aspects.get(current.id);
      let cw = w;
      let ch = h;
      if (aspect) {
        if (w / h > aspect) cw = h * aspect;
        else ch = w / aspect;
      }
      const mx = Math.max(0, (cw * z.s - w) / 2);
      const my = Math.max(0, (ch * z.s - h) / 2);
      return { s: z.s, tx: clamp(z.tx, -mx, mx), ty: clamp(z.ty, -my, my) };
    },
    [loader],
  );

  const applyZoom = useCallback((z: Zoom, animate: boolean) => {
    zoomRef.current = z;
    const el = zoomElRef.current;
    if (el) {
      el.style.transition = animate && !latest.current.reduce ? `transform ${ZOOM_MS}ms ${EASE}` : "none";
      el.style.transform = z.s === 1 && z.tx === 0 && z.ty === 0 ? "" : `translate3d(${z.tx}px, ${z.ty}px, 0) scale(${z.s})`;
    }
    const id = latest.current.photo?.id ?? null;
    setZoomedId(z.s > 1.01 ? id : null);
  }, []);

  /** 松手回弹：轨道回到 0，背景和上下栏恢复不透明。 */
  const settle = useCallback(() => {
    const ms = latest.current.reduce ? 0 : SNAP_MS;
    const track = trackRef.current;
    if (track) {
      track.style.transition = ms ? `transform ${ms}ms ${EASE}` : "none";
      track.style.transform = "translate3d(0, 0, 0)";
    }
    if (zoomRef.current.s <= 1.01) applyZoom(IDENTITY, true);
    setOpacity([backdropRef.current, headerRef.current, footerRef.current], 1, ms);
  }, [applyZoom]);

  const canGo = useCallback((dir: 1 | -1) => {
    const t = latest.current.index + dir;
    return t >= 0 && t < latest.current.count;
  }, []);

  /**
   * 翻一张。instant：不播动画（按住方向键连翻）。
   * 上一次的动画还没走完时再翻，不再把这次吞掉：直接让调用方换到再下一张，
   * 轨道留在原处，等新的 index 提交时由下面的 layout effect 归零。
   */
  const go = useCallback(
    (dir: 1 | -1, instant = false) => {
      const L = latest.current;
      if (zoomRef.current.s > 1.01) return false;
      const target = (wantRef.current ?? L.index) + dir;
      if (target < 0 || target >= L.count) return false;
      videoRef.current?.pause();
      const track = trackRef.current;
      const stage = stageRef.current;
      if (animatingRef.current || instant || !track || !stage || L.reduce) {
        clearTimers();
        animatingRef.current = false;
        wantRef.current = target;
        L.onIndexChange(target);
        return true;
      }
      animatingRef.current = true;
      wantRef.current = target;
      track.style.transition = `transform ${PAGE_MS}ms ${EASE}`;
      track.style.transform = `translate3d(${-dir * (stage.clientWidth + GAP)}px, 0, 0)`;
      timers.current.push(
        window.setTimeout(() => {
          latest.current.onIndexChange(target);
          // 调用方没接这次翻页，就把轨道放回来，免得卡在半路。
          timers.current.push(
            window.setTimeout(() => {
              if (latest.current.index !== target) {
                wantRef.current = null;
                resetTrack();
              }
            }, 150),
          );
        }, PAGE_MS),
      );
      return true;
    },
    [clearTimers, resetTrack],
  );

  const jump = useCallback(
    (i: number) => {
      if (i === latest.current.index) return;
      clearTimers();
      wantRef.current = null;
      videoRef.current?.pause();
      resetTrack();
      latest.current.onIndexChange(i);
    },
    [clearTimers, resetTrack],
  );

  const canZoom = (p: AlbumPhoto | undefined) => !!p && !isVideo(p) && (p.has_preview || p.has_thumb);

  const toggleZoom = (x: number, y: number) => {
    if (!canZoom(latest.current.photo)) return;
    if (zoomRef.current.s > 1.01) {
      applyZoom(IDENTITY, true);
      return;
    }
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = x - (rect.left + rect.width / 2);
    const py = y - (rect.top + rect.height / 2);
    applyZoom(clampZoom({ s: ZOOM_MAX, tx: -px * (ZOOM_MAX - 1), ty: -py * (ZOOM_MAX - 1) }), true);
  };

  // 换张：轨道归零、缩放复位。和新的 slide 位置在同一次提交里生效，不会闪。
  useLayoutEffect(() => {
    clearTimers();
    resetTrack();
    if (wantRef.current === index) wantRef.current = null;
    zoomRef.current = IDENTITY;
    lastTap.current = null;
    window.clearTimeout(tapTimer.current);
    gesture.current = pointers.current.size ? { k: "wait" } : { k: "idle" };
  }, [index, photo?.id, clearTimers, resetTrack]);

  // 预加载当前张和前后各 2 张的预览图。停稳一小会儿再要：按住方向键飞快翻过去的那些就不要了。
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const keep = new Set<string>();
      for (const d of [0, 1, -1, 2, -2]) {
        if (Math.abs(d) > PRELOAD) continue;
        const p = photos[index + d];
        if (!p) continue;
        keep.add(p.id);
        void loader.preview(p, getUrl);
      }
      loader.retain(keep);
    }, PRELOAD_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [index, photos, loader, getUrl]);

  // 锁住 body 滚动，焦点移进灯箱；关闭时都还原。
  useEffect(() => {
    const { body, documentElement } = document;
    const prevOverflow = body.style.overflow;
    const prevPadding = body.style.paddingRight;
    const scrollbar = window.innerWidth - documentElement.clientWidth;
    body.style.overflow = "hidden";
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
    const prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    rootRef.current?.focus({ preventScroll: true });
    return () => {
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPadding;
      clearTimers();
      prevFocus?.focus({ preventScroll: true });
    };
  }, [clearTimers]);

  // 键盘：Esc 先关信息栏、再关灯箱；← → 翻页，按住连翻（焦点在视频上时把方向键留给视频）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey) return;
      if (e.key === "Escape") {
        e.preventDefault();
        if (latest.current.info) setInfo(false);
        else latest.current.onClose();
        return;
      }
      if (e.target instanceof HTMLVideoElement || e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        if (e.repeat) {
          if (e.timeStamp - lastRepeat.current < REPEAT_MS) return;
          lastRepeat.current = e.timeStamp;
        }
        go(e.key === "ArrowLeft" ? -1 : 1, e.repeat);
      }
    };
    // 捕获阶段：Chrome 的原生视频控件会对 Esc 调 preventDefault，冒泡阶段再看就被上面那行挡掉了，
    // 焦点落在视频上时 Esc 关不掉灯箱。
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [go]);

  // 窗口尺寸变了，放大边界就不对了，直接复位。
  useEffect(() => {
    const onResize = () => {
      if (zoomRef.current.s > 1.01) applyZoom(IDENTITY, false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [applyZoom]);

  // 信息栏 / 胶片条开合会改变舞台大小：同样复位缩放。
  useEffect(() => {
    if (zoomRef.current.s > 1.01) applyZoom(IDENTITY, false);
  }, [info, strip, applyZoom]);

  /* ------------------------------------------------------------ gestures */

  const capture = (id: number) => {
    try {
      stageRef.current?.setPointerCapture(id);
    } catch {
      /* 指针已经没了 */
    }
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (animatingRef.current) return;
    const target = e.target as Element;
    if (target.closest("button, a, input")) return;
    if (target instanceof HTMLVideoElement && e.clientY > target.getBoundingClientRect().bottom - VIDEO_CONTROLS_PX) return;

    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;

    if (pointers.current.size === 2) {
      window.clearTimeout(tapTimer.current);
      if (!canZoom(latest.current.photo)) {
        gesture.current = { k: "wait" };
        return;
      }
      if (g.k === "swipe" || g.k === "dismiss") settle();
      const [a, b] = [...pointers.current.values()];
      for (const id of pointers.current.keys()) capture(id);
      const z = zoomRef.current;
      gesture.current = { k: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, s0: z.s, tx0: z.tx, ty0: z.ty };
      lastTap.current = null;
      return;
    }
    if (pointers.current.size > 2 || g.k === "wait") return;

    gesture.current = { k: "press", id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: e.timeStamp };
    samples.current = [{ t: e.timeStamp, x: e.clientX, y: e.clientY }];
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = pointers.current.get(e.pointerId);
    if (!p) return;
    // 鼠标键已经松了却没收到 pointerup（在窗口外松手、被别的元素截走）：当作结束，
    // 不然之后单纯移动鼠标也会被当成拖动，照片跟着走、背景变淡。
    if (e.pointerType === "mouse" && e.buttons === 0) {
      onPointerEnd(e);
      return;
    }
    p.x = e.clientX;
    p.y = e.clientY;
    const g = gesture.current;

    if (g.k === "pinch") {
      if (pointers.current.size < 2) return;
      const [a, b] = [...pointers.current.values()];
      const s = clamp((g.s0 * Math.hypot(a.x - b.x, a.y - b.y)) / g.d0, 1, ZOOM_MAX);
      const ratio = s / g.s0;
      applyZoom(clampZoom({ s, tx: g.tx0 * ratio, ty: g.ty0 * ratio }), false);
      return;
    }
    if (g.k === "idle" || g.k === "wait" || g.id !== e.pointerId) return;

    const list = samples.current;
    list.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
    while (list.length > 2 && e.timeStamp - list[0].t > VELOCITY_WINDOW_MS) list.shift();

    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    const stage = stageRef.current;
    const track = trackRef.current;
    if (!stage || !track) return;

    if (g.k === "press") {
      if (Math.hypot(dx, dy) < SLOP) return;
      capture(e.pointerId);
      lastTap.current = null;
      window.clearTimeout(tapTimer.current);
      if (zoomRef.current.s > 1.01) {
        const z = zoomRef.current;
        gesture.current = { k: "pan", id: g.id, x0: g.x0, y0: g.y0, tx0: z.tx, ty0: z.ty };
      } else if (Math.abs(dx) >= Math.abs(dy)) {
        gesture.current = { k: "swipe", id: g.id, x0: g.x0, y0: g.y0 };
      } else if (dy > 0) {
        gesture.current = { k: "dismiss", id: g.id, x0: g.x0, y0: g.y0 };
      } else {
        gesture.current = { k: "wait" };
        return;
      }
    }

    const cur = gesture.current;
    if (cur.k === "swipe") {
      const w = stage.clientWidth;
      const blocked = (dx > 0 && !canGo(-1)) || (dx < 0 && !canGo(1));
      const x = blocked ? rubber(dx, w) : dx;
      track.style.transition = "none";
      track.style.transform = `translate3d(${x}px, 0, 0)`;
    } else if (cur.k === "dismiss") {
      const y = Math.max(0, dy);
      const progress = Math.min(1, y / (stage.clientHeight * 0.6));
      track.style.transition = "none";
      track.style.transform = `translate3d(${dx * 0.35}px, ${y}px, 0)`;
      const el = zoomElRef.current;
      if (el) {
        el.style.transition = "none";
        el.style.transform = `scale(${1 - progress * 0.15})`;
      }
      setOpacity([backdropRef.current], 1 - progress * 0.85, 0);
      setOpacity([headerRef.current, footerRef.current], 1 - Math.min(1, progress * 2.5), 0);
    } else if (cur.k === "pan") {
      applyZoom(clampZoom({ s: zoomRef.current.s, tx: cur.tx0 + dx, ty: cur.ty0 + dy }), false);
    }
  };

  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    const left = pointers.current.size;

    if (g.k === "pinch") {
      if (left >= 2) return;
      const z = zoomRef.current;
      const s = z.s >= 1.6 ? ZOOM_MAX : 1;
      applyZoom(s === 1 ? IDENTITY : clampZoom({ s, tx: (z.tx * s) / z.s, ty: (z.ty * s) / z.s }), true);
      gesture.current = left ? { k: "wait" } : { k: "idle" };
      return;
    }
    if (g.k === "idle" || g.k === "wait") {
      if (!left) gesture.current = { k: "idle" };
      return;
    }
    if (g.id !== e.pointerId) return;
    gesture.current = left ? { k: "wait" } : { k: "idle" };

    const cancelled = e.type === "pointercancel";
    const list = samples.current;
    const first = list[0];
    const last = list[list.length - 1];
    const dt = last && first ? last.t - first.t : 0;
    const vx = dt > 0 ? (last.x - first.x) / dt : 0;
    const vy = dt > 0 ? (last.y - first.y) / dt : 0;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    const stage = stageRef.current;

    if (g.k === "press") {
      if (cancelled || e.timeStamp - g.t0 > TAP_MS) return;
      const prev = lastTap.current;
      if (prev && e.timeStamp - prev.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < DOUBLE_TAP_PX) {
        lastTap.current = null;
        window.clearTimeout(tapTimer.current);
        toggleZoom(e.clientX, e.clientY);
      } else {
        lastTap.current = { t: e.timeStamp, x: e.clientX, y: e.clientY };
        // 手指单击：等双击的窗口过去，确定不是双击再切换控件显示。
        if (e.pointerType !== "mouse") {
          window.clearTimeout(tapTimer.current);
          tapTimer.current = window.setTimeout(toggleChrome, DOUBLE_TAP_MS);
        }
      }
      return;
    }

    if (g.k === "swipe") {
      const w = stage?.clientWidth ?? 0;
      let dir: 1 | -1 | 0 = 0;
      if (!cancelled) {
        if (dx < -w * PAGE_FRACTION || (vx < -FLICK_SPEED && dx < 0)) dir = 1;
        else if (dx > w * PAGE_FRACTION || (vx > FLICK_SPEED && dx > 0)) dir = -1;
      }
      if (!(dir && go(dir))) settle();
      return;
    }

    if (g.k === "dismiss") {
      if (!cancelled && (dy > DISMISS_PX || (vy > FLICK_SPEED && dy > SLOP * 3))) {
        videoRef.current?.pause();
        latest.current.onClose();
      } else {
        settle();
      }
    }
    // pan：边界已经在拖动时限制好了，松手不需要额外处理。
  };

  if (!photo) return null;

  const liked = photo.liked_by_me;
  const pressable = "transition-transform duration-150 active:scale-[0.97] motion-reduce:transition-none";
  const iconBtn = `grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-[color-mix(in_oklab,var(--color-card)_14%,transparent)] ${pressable}`;
  // 藏起来的控件不能挡住点击：点一下空白处要能把它们叫回来。
  const hit = chrome ? "pointer-events-auto" : "pointer-events-none";
  const fade = `transition-opacity duration-200 motion-reduce:duration-100 ${chrome ? "opacity-100" : "opacity-0"}`;
  const when = shortDateTime(photo.taken_at);
  const stripSpace = `calc(${STRIP_H}px + env(safe-area-inset-bottom))`;
  // 视频的原生控件条（播放键在左下角）会落进左右 20% 的翻页区，点播放变成翻页。
  // 所以视频只留中间那颗圆键当翻页按钮，控件条露出来；圆键在控件显示时常亮，不用先悬停。
  const videoNav = isVideo(photo);
  const navShow = !chrome ? "opacity-0" : videoNav ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100";
  const navZone = videoNav ? "top-1/2 -translate-y-1/2" : "bottom-0 top-16 w-[20%]";
  const chip: CSSProperties = { background: CHIP, color: INK };

  const toggleStrip = () => setStrip((open) => !open);

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={`照片预览：${photo.filename}`}
      tabIndex={-1}
      className="fixed inset-0 z-[100] select-none overflow-hidden"
      style={{ color: INK, outline: "none", overscrollBehavior: "contain", cursor: chrome ? undefined : "none" }}
      onPointerMove={onMouseActivity}
      onPointerDown={onMouseActivity}
      onPointerLeave={() => { overControls.current = false; }}
      onFocusCapture={(e) => { if (e.target !== rootRef.current) showChrome(finePointer()); }}
    >
      <div ref={backdropRef} aria-hidden="true" className="absolute inset-0" style={{ background: BACKDROP }} />

      {/* 照片这一栏。信息栏在桌面上占右边 360px，照片跟着让出来；手机上信息栏从底部盖上来。 */}
      <div className={`absolute inset-y-0 left-0 right-0 ${info ? "sm:right-[360px]" : ""}`}>
        <div
          ref={stageRef}
          className="absolute inset-x-0 top-0 overflow-hidden"
          style={{ bottom: strip ? stripSpace : 0, touchAction: "none", cursor: zoomed ? "grab" : undefined }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        >
          <div ref={trackRef} className="absolute inset-0" style={{ willChange: "transform" }}>
            {[-1, 0, 1].map((off) => {
              const p = photos[index + off];
              if (!p) return null;
              return (
                <Slide
                  key={p.id}
                  photo={p}
                  offset={off}
                  active={off === 0}
                  loader={loader}
                  getUrl={getUrl}
                  cachedThumb={cachedThumb}
                  reduce={reduce}
                  zoomRef={setZoomEl}
                  videoRef={videoRef}
                  onVideoPlay={scheduleHide}
                  original={originals.has(p.id)}
                />
              );
            })}
          </div>

          {/* 左右各 20% 的翻页区：鼠标移进去才出现 56px 的圆键，点整个区域都能翻（视频除外，见 navZone）。手机上没有，靠滑动。 */}
          {!zoomed && index > 0 && (
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="上一张"
              className={`group absolute left-0 z-10 hidden items-center justify-start pl-3 focus-visible:outline-none pointer-fine:flex sm:pl-5 ${navZone}`}
              style={{ cursor: chrome ? "pointer" : "none" }}
            >
              <span
                className={`grid h-14 w-14 place-items-center rounded-full transition-opacity duration-200 group-focus-visible:outline-2 group-focus-visible:outline-card motion-reduce:duration-100 ${navShow}`}
                style={{ background: NAV_BG, color: INK }}
              >
                <AdminIcon name="back" className="h-7 w-7" />
              </span>
            </button>
          )}
          {!zoomed && index < count - 1 && (
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="下一张"
              className={`group absolute right-0 z-10 hidden items-center justify-end pr-3 focus-visible:outline-none pointer-fine:flex sm:pr-5 ${navZone}`}
              style={{ cursor: chrome ? "pointer" : "none" }}
            >
              <span
                className={`grid h-14 w-14 place-items-center rounded-full transition-opacity duration-200 group-focus-visible:outline-2 group-focus-visible:outline-card motion-reduce:duration-100 ${navShow}`}
                style={{ background: NAV_BG, color: INK }}
              >
                <AdminIcon name="chevron" className="h-7 w-7" />
              </span>
            </button>
          )}
        </div>

        {/* 顶栏：浮在照片上，只有按钮本身接点击，照片上的滑动从顶部开始也照样生效。 */}
        <div className={`pointer-events-none absolute inset-x-0 top-0 z-20 ${fade}`}>
          <div
            ref={headerRef}
            className="flex items-start gap-1 px-1.5 pb-8 sm:gap-2 sm:px-3"
            style={{ paddingTop: "max(env(safe-area-inset-top), 8px)", background: SCRIM_TOP }}
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="返回相册"
              data-controls
              className={`inline-flex h-11 shrink-0 items-center gap-1 rounded-full px-2.5 text-sm font-black hover:bg-[color-mix(in_oklab,var(--color-card)_14%,transparent)] ${pressable} ${hit}`}
            >
              <AdminIcon name="back" className="h-6 w-6" />
              <span className="hidden sm:inline">返回</span>
            </button>
            <div className="min-w-0 flex-1 px-1 pt-1.5">
              <p className="truncate text-sm font-black">{photo.filename}</p>
              <p className="tabular truncate text-xs font-bold" style={{ color: INK_DIM }}>
                {when && <span>{when} · </span>}
                <span aria-live="polite" aria-label={`第 ${index + 1} 张，共 ${count} 张`}>{index + 1} / {count}</span>
              </p>
            </div>
            <div data-controls className={`flex shrink-0 items-center gap-0.5 sm:gap-1 ${hit}`}>
              <button
                type="button"
                onClick={() => onToggleLike(photo)}
                aria-pressed={liked}
                aria-label={`${liked ? "取消爱心" : "点爱心"}，现在 ${photo.like_count} 个`}
                className={`inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-black hover:bg-[color-mix(in_oklab,var(--color-card)_14%,transparent)] ${pressable}`}
              >
                <span style={{ color: liked ? LIKED : INK }}>
                  <HeartIcon filled={liked} />
                </span>
                <span className="tabular">{photo.like_count}</span>
              </button>
              {isVideo(photo) && photo.has_proxy && (
                <button
                  type="button"
                  onClick={() => setOriginals((prev) => {
                    const next = new Set(prev);
                    if (next.has(photo.id)) next.delete(photo.id);
                    else next.add(photo.id);
                    return next;
                  })}
                  aria-pressed={originals.has(photo.id)}
                  title={originals.has(photo.id) ? "正在播原画质，点一下换回省流量的低画质" : "现在是低画质，点一下播原画质（文件大，要等一会儿）"}
                  className={`h-9 shrink-0 rounded-full px-3 text-xs font-black hover:bg-[color-mix(in_oklab,var(--color-card)_14%,transparent)] ${pressable}`}
                  style={originals.has(photo.id) ? chip : { color: INK, boxShadow: `inset 0 0 0 1px ${INK_DIM}` }}
                >
                  原画质
                </button>
              )}
              <button type="button" onClick={() => onDownload(photo)} aria-label="下载原片" title="下载原片" className={iconBtn}>
                <AdminIcon name="download" className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => setInfo((open) => !open)}
                aria-label="照片信息"
                aria-pressed={info}
                title="信息"
                className={iconBtn}
                style={info ? chip : undefined}
              >
                <AdminIcon name="info" className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={toggleStrip}
                aria-label={strip ? "收起胶片条" : "展开胶片条"}
                aria-pressed={strip}
                title="胶片条"
                className={iconBtn}
                style={strip ? chip : undefined}
              >
                <AdminIcon name="film" className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>

        {strip && (
          <div data-controls className={`absolute inset-x-0 bottom-0 z-20 ${fade} ${hit}`} style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
            <div ref={footerRef} className="pt-1" style={{ height: STRIP_H }}>
              <FilmStrip photos={photos} index={index} cachedThumb={cachedThumb} reduce={reduce} onSelect={jump} />
            </div>
          </div>
        )}
      </div>

      {info && (
        <aside
          data-controls
          aria-label="照片信息"
          className="tool-scroll absolute z-30 overflow-y-auto max-sm:inset-x-0 max-sm:bottom-0 max-sm:max-h-[70dvh] max-sm:rounded-t-[20px] sm:inset-y-0 sm:right-0 sm:w-[360px]"
          style={{ background: PANEL_BG, color: INK, paddingBottom: "max(env(safe-area-inset-bottom), 16px)" }}
        >
          <div className="flex items-center justify-between gap-3 py-3 pl-5 pr-2">
            <h2 className="text-base font-black">信息</h2>
            <button type="button" onClick={() => setInfo(false)} aria-label="关闭信息" className={iconBtn}>
              <AdminIcon name="close" className="h-5 w-5" />
            </button>
          </div>
          <dl className="space-y-4 px-5 pb-4">
            <InfoRow label="文件名">{photo.filename}</InfoRow>
            <InfoRow label="拍摄时间">{fullDateTime(photo.taken_at) || "没有记录"}</InfoRow>
            <InfoRow label="上传时间">{fullDateTime(photo.created_at) || "没有记录"}</InfoRow>
            <InfoRow label="大小"><span className="tabular">{formatBytes(photo.size_bytes)}</span></InfoRow>
            <InfoRow label="类型">
              {isVideo(photo) ? "视频" : "照片"} · <span className="uppercase">{fileKind(photo)}</span>
              <span className="font-semibold" style={{ color: INK_DIM }}> · {photo.content_type}</span>
            </InfoRow>
            <InfoRow label="爱心">
              <span className="tabular">{photo.like_count} 个</span>
              {liked && <span style={{ color: INK_DIM }}>，有一个是你点的</span>}
            </InfoRow>
          </dl>
        </aside>
      )}
    </div>,
    document.body,
  );
}
