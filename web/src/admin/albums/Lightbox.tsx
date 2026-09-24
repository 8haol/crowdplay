/*
 * 活动相册灯箱（设计 7.5）。只管「看」：取 URL、爱心、下载都交回调用方。
 *
 * 顺滑的几个关键：
 * - 先把缓存的缩略图拉伸铺满，预览图 decode() 完再 150ms 交叉淡入，不闪白。
 * - 手势全部走 pointer events，拖动时直接写 transform（translate3d），不经过 React 渲染。
 * - 只挂当前 ±1 张的大图 DOM；预览图预加载前后各 2 张。
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
} from "react";
import { createPortal } from "react-dom";
import { AdminIcon } from "../adminUi";
import { isVideo, type AlbumPhoto, type LightboxProps, type ViewKind } from "./albumTypes";

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
const VELOCITY_WINDOW_MS = 100;

const INK = "var(--color-card)";
const INK_DIM = "color-mix(in oklab, var(--color-card) 68%, transparent)";
const CHIP = "color-mix(in oklab, var(--color-card) 14%, transparent)";
const BLOCK = "color-mix(in oklab, var(--color-card) 10%, transparent)";
const BACKDROP = "var(--color-admin-rail-line)";
const LIKED = "var(--color-seal-deep)";
const EASE = "var(--ease-out-expo)";

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

  const [videoUrl, setVideoUrl] = useState<string | null | undefined>(undefined);

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
    if (!video || !active || videoUrl !== undefined) return;
    let alive = true;
    void loader.original(photo, getUrl).then((url) => {
      if (alive) setVideoUrl(url);
    });
    return () => {
      alive = false;
    };
  }, [photo, video, active, videoUrl, loader, getUrl]);

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

export function Lightbox(props: LightboxProps) {
  const { photos, onIndexChange, onClose, getUrl, cachedThumb, onToggleLike, onDownload } = props;
  const count = photos.length;
  const index = count ? clamp(Math.round(props.index), 0, count - 1) : 0;
  const photo: AlbumPhoto | undefined = photos[index];
  const reduce = useReducedMotion();

  const [loader] = useState(createLoader);

  const latest = useRef({ index, count, photo, reduce, onIndexChange, onClose });
  useLayoutEffect(() => {
    latest.current = { index, count, photo, reduce, onIndexChange, onClose };
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
  const timers = useRef<number[]>([]);
  const gesture = useRef<Gesture>({ k: "idle" });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const samples = useRef<Sample[]>([]);
  const lastTap = useRef<Sample | null>(null);

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

  const go = useCallback(
    (dir: 1 | -1) => {
      const L = latest.current;
      if (animatingRef.current || zoomRef.current.s > 1.01 || !canGo(dir)) return false;
      const target = L.index + dir;
      videoRef.current?.pause();
      const track = trackRef.current;
      const stage = stageRef.current;
      if (!track || !stage || L.reduce) {
        L.onIndexChange(target);
        return true;
      }
      animatingRef.current = true;
      track.style.transition = `transform ${PAGE_MS}ms ${EASE}`;
      track.style.transform = `translate3d(${-dir * (stage.clientWidth + GAP)}px, 0, 0)`;
      timers.current.push(
        window.setTimeout(() => {
          latest.current.onIndexChange(target);
          // 调用方没接这次翻页，就把轨道放回来，免得卡在半路。
          timers.current.push(
            window.setTimeout(() => {
              if (latest.current.index !== target) resetTrack();
            }, 150),
          );
        }, PAGE_MS),
      );
      return true;
    },
    [canGo, resetTrack],
  );

  const jump = useCallback(
    (i: number) => {
      if (i === latest.current.index) return;
      clearTimers();
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
    zoomRef.current = IDENTITY;
    lastTap.current = null;
    gesture.current = pointers.current.size ? { k: "wait" } : { k: "idle" };
  }, [index, photo?.id, clearTimers, resetTrack]);

  // 预加载当前张和前后各 2 张的预览图。
  useEffect(() => {
    const keep = new Set<string>();
    for (const d of [0, 1, -1, 2, -2]) {
      if (Math.abs(d) > PRELOAD) continue;
      const p = photos[index + d];
      if (!p) continue;
      keep.add(p.id);
      void loader.preview(p, getUrl);
    }
    loader.retain(keep);
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

  // 键盘：Esc 关闭，← → 翻页（焦点在视频上时把方向键留给视频）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey) return;
      if (e.key === "Escape") {
        e.preventDefault();
        latest.current.onClose();
        return;
      }
      if (e.target instanceof HTMLVideoElement || e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        go(e.key === "ArrowLeft" ? -1 : 1);
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
        toggleZoom(e.clientX, e.clientY);
      } else {
        lastTap.current = { t: e.timeStamp, x: e.clientX, y: e.clientY };
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

  const chip: CSSProperties = { background: CHIP, color: INK };
  const liked = photo.liked_by_me;
  const pressable = "transition-transform duration-150 active:scale-[0.97] motion-reduce:transition-none";

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={`照片预览：${photo.filename}`}
      tabIndex={-1}
      className="fixed inset-0 z-[100] flex select-none flex-col overflow-hidden"
      style={{ color: INK, outline: "none", overscrollBehavior: "contain" }}
    >
      <div ref={backdropRef} aria-hidden="true" className="absolute inset-0" style={{ background: BACKDROP }} />

      <div
        ref={headerRef}
        className="relative flex min-h-14 shrink-0 items-center gap-3 pl-4 pr-2"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <p className="min-w-0 flex-1 truncate text-sm font-bold" style={{ color: INK_DIM }}>{photo.filename}</p>
        <button type="button" onClick={onClose} aria-label="关闭" className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${pressable}`} style={chip}>
          <AdminIcon name="close" className="h-5 w-5" />
        </button>
      </div>

      <div
        ref={stageRef}
        className="relative min-h-0 flex-1 overflow-hidden"
        style={{ touchAction: "none", cursor: zoomed ? "grab" : undefined }}
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
              />
            );
          })}
        </div>

        {!zoomed && index > 0 && (
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="上一张"
            className="group absolute bottom-20 left-0 top-0 z-10 hidden w-[22%] max-w-40 items-center justify-start pl-4 pointer-fine:flex"
          >
            <span className="grid h-11 w-11 place-items-center rounded-full opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none" style={chip}>
              <AdminIcon name="back" className="h-5 w-5" />
            </span>
          </button>
        )}
        {!zoomed && index < count - 1 && (
          <button
            type="button"
            onClick={() => go(1)}
            aria-label="下一张"
            className="group absolute bottom-20 right-0 top-0 z-10 hidden w-[22%] max-w-40 items-center justify-end pr-4 pointer-fine:flex"
          >
            <span className="grid h-11 w-11 place-items-center rounded-full opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none" style={chip}>
              <AdminIcon name="chevron" className="h-5 w-5" />
            </span>
          </button>
        )}
      </div>

      <div ref={footerRef} className="relative shrink-0" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }}>
        <div className="flex items-center gap-2 px-4 py-2">
          <button
            type="button"
            onClick={() => onToggleLike(photo)}
            aria-pressed={liked}
            aria-label={`${liked ? "取消喜欢" : "喜欢"}，${photo.like_count} 人喜欢`}
            className={`inline-flex h-10 items-center gap-1.5 rounded-full px-3.5 text-sm font-black ${pressable}`}
            style={chip}
          >
            <span style={{ color: liked ? LIKED : INK }}>
              <HeartIcon filled={liked} />
            </span>
            <span className="tabular">{photo.like_count}</span>
          </button>
          <button
            type="button"
            onClick={() => onDownload(photo)}
            aria-label="下载原片"
            className={`inline-flex h-10 items-center gap-1.5 rounded-full px-3.5 text-sm font-black ${pressable}`}
            style={chip}
          >
            <AdminIcon name="download" className="h-5 w-5" />
            <span className="hidden sm:inline">下载原片</span>
          </button>
          <span className="tabular ml-auto text-sm font-black" aria-live="polite" aria-label={`第 ${index + 1} 张，共 ${count} 张`}>
            {index + 1} / {count}
          </span>
        </div>
        <FilmStrip photos={photos} index={index} cachedThumb={cachedThumb} reduce={reduce} onSelect={jump} />
      </div>
    </div>,
    document.body,
  );
}
