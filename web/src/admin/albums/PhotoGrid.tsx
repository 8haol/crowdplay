import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { AdminIcon } from "../adminUi";
import { T } from "../adminTokens";
import { peekUrl, viewUrl } from "./albumApi";
import { isVideo, type AlbumPhoto } from "./albumTypes";
import { columnsFor, type DayGroup, type SizeId } from "./albumView";

/*
 * 相册网格：方格、密排（像 Google Photos 的方格模式），按拍摄日期分段。
 *
 * 选择照 Google Photos：鼠标悬停时左上角出现圆形勾选框，点它就进入多选；
 * 多选时点图 = 切换选中，Shift+点 = 连选一段；手机上长按进入多选。
 * 列数按容器宽度算（ResizeObserver），不按窗口：桌面左边还有一条导航。
 */

const PILL = { background: "rgb(from var(--color-admin-overlay) r g b / .58)", color: "var(--color-card)" };
const SCRIM = "linear-gradient(to bottom, rgb(from var(--color-admin-overlay) r g b / .42), transparent)";
const LONG_PRESS_MS = 450;

/** Shift+点击默认会把整页的文字选成一片蓝：连选照片时不要这个。 */
const noShiftSelect = (event: { shiftKey: boolean; preventDefault: () => void }) => {
  if (event.shiftKey) event.preventDefault();
};

export interface PhotoGridProps {
  adminKey: string;
  groups: DayGroup[];
  /** 按拍摄时间排序时才显示日期小标题。 */
  grouped: boolean;
  size: SizeId;
  selecting: boolean;
  selected: ReadonlySet<string>;
  onTile: (photo: AlbumPhoto, shift: boolean) => void;
  onCheck: (photo: AlbumPhoto, shift: boolean) => void;
  onLongPress: (photo: AlbumPhoto) => void;
  onLike: (photo: AlbumPhoto) => void;
  onSelectDay: (group: DayGroup, select: boolean) => void;
}

function estimateWidth() {
  if (typeof window === "undefined") return 1000;
  const w = Math.min(window.innerWidth, 1560);
  return w >= 1024 ? w - 272 - 64 : w - (w >= 640 ? 48 : 32);
}

function layoutFor(width: number, size: SizeId) {
  return { cols: columnsFor(width, size), gap: width < 640 ? 2 : 4 };
}

export const PhotoGrid = memo(function PhotoGrid(props: PhotoGridProps) {
  const { adminKey, groups, grouped, size, selecting, selected, onTile, onCheck, onLongPress, onLike, onSelectDay } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(estimateWidth);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next) setWidth(next);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { cols, gap } = layoutFor(width, size);
  const gridStyle = { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap };

  return (
    <div ref={wrapRef} className="min-w-0">
      {groups.map((group) => {
        let selectedCount = 0;
        if (selecting) for (const photo of group.photos) if (selected.has(photo.id)) selectedCount++;
        return (
          <section key={group.key} aria-label={grouped ? `${group.label}，${group.photos.length} 张` : undefined}>
            {grouped && (
              <DayHeader
                group={group}
                selecting={selecting}
                selectedCount={selectedCount}
                onToggle={onSelectDay}
              />
            )}
            <div className="grid" style={gridStyle}>
              {group.photos.map((photo) => (
                <PhotoTile
                  key={photo.id}
                  adminKey={adminKey}
                  photo={photo}
                  selecting={selecting}
                  selected={selecting && selected.has(photo.id)}
                  onTile={onTile}
                  onCheck={onCheck}
                  onLongPress={onLongPress}
                  onLike={onLike}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
});

/* ------------------------------------------------------------ 勾选圈 */

function CheckCircle({ state, onPhoto }: { state: "on" | "some" | "off"; onPhoto: boolean }) {
  const look =
    state === "on"
      ? { background: T.ink, color: "var(--color-card)", border: "2px solid var(--color-card)" }
      : state === "some"
        ? { background: "var(--color-card)", color: T.ink, border: `2px solid ${T.ink}` }
        : onPhoto
          ? { background: "rgb(from var(--color-admin-overlay) r g b / .22)", border: "2px solid var(--color-card)" }
          : { background: "var(--color-card)", border: `2px solid ${T.inkFaint}` };
  return (
    <span aria-hidden="true" className="grid h-6 w-6 place-items-center rounded-full transition-colors duration-150" style={look}>
      {state === "on" && <AdminIcon name="check" className="h-3.5 w-3.5" />}
      {state === "some" && <span className="h-0.5 w-2.5 rounded-full" style={{ background: T.ink }} />}
    </span>
  );
}

/* ------------------------------------------------------------ 日期小标题 */

function DayHeader({
  group,
  selecting,
  selectedCount,
  onToggle,
}: {
  group: DayGroup;
  selecting: boolean;
  selectedCount: number;
  onToggle: (group: DayGroup, select: boolean) => void;
}) {
  const count = group.photos.length;
  const all = selecting && selectedCount === count;
  const state = all ? "on" : selectedCount > 0 ? "some" : "off";
  return (
    <div className="group/day flex min-h-10 items-center gap-1.5 pb-1.5 pt-4">
      <button
        type="button"
        aria-label={all ? `取消选择${group.label}的 ${count} 张` : `全选${group.label}的 ${count} 张`}
        aria-pressed={all}
        title={all ? "取消选择这一天" : "全选这一天"}
        onClick={() => onToggle(group, !all)}
        className={`-ml-1 grid h-8 w-8 shrink-0 place-items-center rounded-full transition-opacity duration-150 motion-reduce:transition-none ${
          selecting ? "opacity-100" : "opacity-0 focus-visible:opacity-100 group-hover/day:opacity-100 pointer-coarse:hidden"
        }`}
      >
        <CheckCircle state={state} onPhoto={false} />
      </button>
      <h3 className="min-w-0 truncate text-sm font-black">
        {group.label}
        <span className="tabular font-bold" style={{ color: T.inkFaint }}> · {count} 张</span>
      </h3>
    </div>
  );
}

/* ------------------------------------------------------------------ 格子 */

/*
 * 整个网格共用一个 IntersectionObserver：几千格各开一个太浪费。
 * 提前 600px 开始要 URL，滚到时图多半已经在路上了。
 */
const watchers = new Map<Element, () => void>();
let observer: IntersectionObserver | null = null;

function watch(element: Element, onVisible: () => void): () => void {
  if (typeof IntersectionObserver === "undefined") {
    queueMicrotask(onVisible);
    return () => undefined;
  }
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const callback = watchers.get(entry.target);
        if (!callback) continue;
        watchers.delete(entry.target);
        observer?.unobserve(entry.target);
        callback();
      }
    },
    { rootMargin: "600px 0px" },
  );
  watchers.set(element, onVisible);
  observer.observe(element);
  return () => {
    watchers.delete(element);
    observer?.unobserve(element);
  };
}

function useSeen(ref: RefObject<Element | null>): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || seen) return;
    return watch(element, () => setSeen(true));
  }, [ref, seen]);
  return seen;
}

const PhotoTile = memo(function PhotoTile({
  adminKey,
  photo,
  selecting,
  selected,
  onTile,
  onCheck,
  onLongPress,
  onLike,
}: {
  adminKey: string;
  photo: AlbumPhoto;
  selecting: boolean;
  selected: boolean;
  onTile: (photo: AlbumPhoto, shift: boolean) => void;
  onCheck: (photo: AlbumPhoto, shift: boolean) => void;
  onLongPress: (photo: AlbumPhoto) => void;
  onLike: (photo: AlbumPhoto) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const seen = useSeen(ref);
  const [fetched, setFetched] = useState<{ id: string; url: string | null } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [broken, setBroken] = useState(false);
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const longPressed = useRef(false);
  const photoId = photo.id;
  const hasThumb = photo.has_thumb;

  useEffect(() => {
    if (!seen || !hasThumb || peekUrl("thumb", photoId)) return;
    let alive = true;
    viewUrl(adminKey, photoId, "thumb").then((url) => { if (alive) setFetched({ id: photoId, url }); });
    return () => { alive = false; };
  }, [seen, hasThumb, photoId, adminKey]);

  const url = hasThumb ? peekUrl("thumb", photoId) ?? (fetched?.id === photoId ? fetched.url : null) : null;
  const video = isVideo(photo);
  const showImage = Boolean(url) && !broken;
  const waiting = hasThumb && !broken && (!url || !loaded) && !(fetched?.id === photoId && fetched.url === null);

  // 换了排序、格子重新挂上时，图多半已经在内存缓存里：直接显示，不再从 0 淡入一次。
  useLayoutEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) setLoaded(true);
  }, [url]);

  const cancelPress = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };

  const onPointerDown = (event: ReactPointerEvent) => {
    longPressed.current = false;
    cancelPress();
    // 长按只给手指 / 笔；鼠标按久一点不该突然进入多选。
    if (event.pointerType === "mouse") return;
    press.current = {
      x: event.clientX,
      y: event.clientY,
      timer: setTimeout(() => {
        press.current = null;
        longPressed.current = true;
        navigator.vibrate?.(10);
        onLongPress(photo);
      }, LONG_PRESS_MS),
    };
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    const start = press.current;
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) cancelPress();
  };

  const liked = photo.liked_by_me;
  const showLike = liked || photo.like_count > 0;

  return (
    <div
      ref={ref}
      data-photo-id={photo.id}
      className="group relative aspect-square min-w-0 overflow-hidden"
      style={{ background: selected ? "var(--color-admin-neutral)" : T.panelAlt }}
    >
      <button
        type="button"
        aria-label={selecting ? `选择 ${photo.filename}` : `打开 ${photo.filename}`}
        aria-pressed={selecting ? selected : undefined}
        className="absolute inset-0 block h-full w-full select-none focus-visible:outline-offset-[-3px]"
        style={{ WebkitTouchCallout: "none" }}
        onMouseDown={noShiftSelect}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={cancelPress}
        onPointerCancel={cancelPress}
        onPointerLeave={cancelPress}
        onContextMenu={(event) => { if (longPressed.current || press.current) event.preventDefault(); }}
        onClick={(event) => {
          if (longPressed.current) { longPressed.current = false; return; }
          onTile(photo, event.shiftKey);
        }}
      >
        <span
          className="absolute inset-0 overflow-hidden transition-[transform,border-radius] duration-150 ease-out motion-reduce:transition-none"
          style={selected ? { transform: "scale(0.86)", borderRadius: 6 } : undefined}
        >
          {showImage && url ? (
            <img
              ref={imgRef}
              src={url}
              alt=""
              decoding="async"
              draggable={false}
              onLoad={() => setLoaded(true)}
              onError={() => setBroken(true)}
              className="pointer-events-none h-full w-full object-cover transition-opacity duration-150 motion-reduce:transition-none"
              style={{ opacity: loaded ? 1 : 0 }}
            />
          ) : waiting ? (
            <span className="block h-full w-full animate-pulse bg-admin-skeleton" />
          ) : (
            <span className="flex h-full w-full flex-col items-center justify-center gap-1.5 p-2" style={{ color: T.inkFaint }}>
              <AdminIcon name={video ? "video" : "image"} className="h-6 w-6 shrink-0" />
              <span className="line-clamp-2 w-full break-all text-center text-[10px] font-bold leading-tight" style={{ color: T.inkSoft }}>
                {photo.filename}
              </span>
            </span>
          )}
        </span>
      </button>

      {/* 顶部一层淡淡的暗色，白色勾选圈压在亮照片上也看得见。 */}
      {!selected && (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-x-0 top-0 h-12 transition-opacity duration-150 motion-reduce:transition-none ${
            selecting ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
          style={{ background: SCRIM }}
        />
      )}

      <button
        type="button"
        aria-label={selected ? `取消选择 ${photo.filename}` : `选择 ${photo.filename}`}
        aria-pressed={selected}
        className={`absolute left-0 top-0 grid h-9 w-9 place-items-center transition-opacity duration-150 focus-visible:outline-offset-[-3px] motion-reduce:transition-none ${
          selecting ? "opacity-100" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:pointer-events-none"
        }`}
        onMouseDown={noShiftSelect}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => { event.stopPropagation(); onCheck(photo, event.shiftKey); }}
      >
        <CheckCircle state={selected ? "on" : "off"} onPhoto />
      </button>

      {video && showImage && (
        <span className="pointer-events-none absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full sm:right-1.5 sm:top-1.5" style={PILL}>
          <AdminIcon name="video" className="h-3 w-3" />
        </span>
      )}

      <button
        type="button"
        aria-label={liked ? `取消爱心，现在 ${photo.like_count} 个` : `点爱心，现在 ${photo.like_count} 个`}
        aria-pressed={liked}
        className={`pressable tabular absolute bottom-1 right-1 inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-full px-1.5 text-[11px] font-black sm:bottom-1.5 sm:right-1.5 ${
          showLike ? "" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"
        }`}
        style={PILL}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => { event.stopPropagation(); onLike(photo); }}
      >
        <span aria-hidden="true" className="text-[12px] leading-none">{liked ? "❤️" : "🤍"}</span>
        {photo.like_count > 0 && <span>{photo.like_count}</span>}
      </button>
    </div>
  );
});
