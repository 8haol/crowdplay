import {
  memo,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
} from "react";
import { AdminIcon } from "../adminUi";
import { T } from "../adminTokens";
import { peekThumb, requestThumb } from "./thumbCache";
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
  gridRef?: Ref<PhotoGridHandle>;
}

function estimateWidth() {
  if (typeof window === "undefined") return 1000;
  const w = Math.min(window.innerWidth, 1560);
  return w >= 1024 ? w - 272 - 64 : w - (w >= 640 ? 48 : 32);
}

function layoutFor(width: number, size: SizeId) {
  return { cols: columnsFor(width, size), gap: width < 640 ? 2 : 4 };
}

/*
 * 只渲染视口上下各 OVERSCAN 屏以内的行（像 Google 相册、原生相册的格子回收）。
 * 以前 689 格全挂在页面上，每张缩略图解码后约 0.5MB，iPhone Safari 顶不住就把屏幕外的
 * 丢掉，滑回来重新解码，于是闪灰、掉帧。方格等高、列数已知，所以每行的位置可以直接算，
 * 不用量：外层给出总高度，行和格子绝对定位。滑走的格子卸掉，缩略图留在 thumbCache 里，
 * 滑回来几毫秒就能再显示。
 */
const HEADER_H = 54; // DayHeader：pt-4 + h-8 + pb-1.5
const OVERSCAN = 1.5;
/** 从灯箱回来把那张滚进视野时，顶上要让出吸顶的导航栏 + 工具条。 */
const REVEAL_TOP = 180;

type Row =
  | { kind: "header"; group: DayGroup; top: number }
  | { kind: "photos"; photos: AlbumPhoto[]; top: number };

interface Layout {
  rows: Row[];
  height: number;
  cell: number;
  rowOf: Map<string, number>;
}

function buildLayout(groups: DayGroup[], grouped: boolean, width: number, cols: number, gap: number): Layout {
  const cell = Math.max(0, (width - gap * (cols - 1)) / cols);
  const rows: Row[] = [];
  const rowOf = new Map<string, number>();
  let y = 0;
  for (const group of groups) {
    if (grouped) {
      rows.push({ kind: "header", group, top: y });
      y += HEADER_H;
    }
    for (let i = 0; i < group.photos.length; i += cols) {
      const photos = group.photos.slice(i, i + cols);
      for (const photo of photos) rowOf.set(photo.id, rows.length);
      rows.push({ kind: "photos", photos, top: y });
      y += cell + (i + cols < group.photos.length ? gap : 0);
    }
  }
  return { rows, height: y, cell, rowOf };
}

const rowHeight = (row: Row, cell: number) => (row.kind === "header" ? HEADER_H : cell);

/** 第一个底边在 y 之下的行。 */
function firstRowEndingAfter(layout: Layout, y: number): number {
  const { rows, cell } = layout;
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].top + rowHeight(rows[mid], cell) <= y) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function visibleRows(layout: Layout, el: HTMLElement | null): [number, number] {
  if (!el || layout.rows.length === 0) return [0, -1];
  const top = el.getBoundingClientRect().top;
  const vh = window.innerHeight || 800;
  const from = -top - vh * OVERSCAN;
  const to = -top + vh * (1 + OVERSCAN);
  const first = firstRowEndingAfter(layout, from);
  let last = first;
  while (last + 1 < layout.rows.length && layout.rows[last + 1].top < to) last++;
  return [first, last];
}

export interface PhotoGridHandle {
  /** 把这张滚进视野（它可能没挂在页面上，所以不能 querySelector）。 */
  reveal: (photoId: string) => void;
}

export const PhotoGrid = memo(function PhotoGrid(props: PhotoGridProps) {
  const { adminKey, groups, grouped, size, selecting, selected, onTile, onCheck, onLongPress, onLike, onSelectDay, gridRef } = props;
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
  const layout = useMemo(() => buildLayout(groups, grouped, width, cols, gap), [groups, grouped, width, cols, gap]);
  const layoutRef = useRef(layout);

  const [range, setRange] = useState<[number, number]>([0, -1]);
  useLayoutEffect(() => {
    layoutRef.current = layout;
    let frame = 0;
    const update = () => {
      frame = 0;
      const next = visibleRows(layoutRef.current, wrapRef.current);
      setRange((prev) => (prev[0] === next[0] && prev[1] === next[1] ? prev : next));
    };
    const schedule = () => { frame ||= requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [layout]);

  useImperativeHandle(gridRef, () => ({
    reveal(photoId) {
      const current = layoutRef.current;
      const index = current.rowOf.get(photoId);
      const el = wrapRef.current;
      if (index === undefined || !el) return;
      const row = current.rows[index];
      const top = el.getBoundingClientRect().top + window.scrollY + row.top;
      const bottom = top + current.cell;
      // 直接跳过去：html 上是 smooth，平滑滚过几千像素会把沿途的行全挂一遍。
      if (top < window.scrollY + REVEAL_TOP) window.scrollTo({ top: top - REVEAL_TOP, behavior: "instant" });
      else if (bottom > window.scrollY + window.innerHeight) window.scrollTo({ top: bottom - window.innerHeight + 16, behavior: "instant" });
    },
  }), []);

  const { cell } = layout;
  const items: ReactNode[] = [];
  for (let i = range[0]; i <= range[1] && i < layout.rows.length; i++) {
    const row = layout.rows[i];
    if (row.kind === "header") {
      let selectedCount = 0;
      if (selecting) for (const photo of row.group.photos) if (selected.has(photo.id)) selectedCount++;
      items.push(
        <div key={`h:${row.group.key}`} className="absolute inset-x-0" style={{ top: row.top, height: HEADER_H }}>
          <DayHeader group={row.group} selecting={selecting} selectedCount={selectedCount} onToggle={onSelectDay} />
        </div>,
      );
      continue;
    }
    row.photos.forEach((photo, col) => {
      items.push(
        <PhotoTile
          key={photo.id}
          top={row.top}
          left={col * (cell + gap)}
          cell={cell}
          adminKey={adminKey}
          photo={photo}
          selecting={selecting}
          selected={selecting && selected.has(photo.id)}
          onTile={onTile}
          onCheck={onCheck}
          onLongPress={onLongPress}
          onLike={onLike}
        />,
      );
    });
  }

  return (
    <div ref={wrapRef} className="relative min-w-0" style={{ height: layout.height }}>
      {items}
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
    <div className="group/day flex h-full items-center gap-1.5 pb-1.5 pt-4">
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

const PhotoTile = memo(function PhotoTile({
  top,
  left,
  cell,
  adminKey,
  photo,
  selecting,
  selected,
  onTile,
  onCheck,
  onLongPress,
  onLike,
}: {
  top: number;
  left: number;
  cell: number;
  adminKey: string;
  photo: AlbumPhoto;
  selecting: boolean;
  selected: boolean;
  onTile: (photo: AlbumPhoto, shift: boolean) => void;
  onCheck: (photo: AlbumPhoto, shift: boolean) => void;
  onLongPress: (photo: AlbumPhoto) => void;
  onLike: (photo: AlbumPhoto) => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [fetched, setFetched] = useState<{ id: string; url: string | null } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [broken, setBroken] = useState(false);
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const longPressed = useRef(false);
  const photoId = photo.id;
  const hasThumb = photo.has_thumb;

  // 挂上时内存里已经有的（滑回来的）直接显示，不再淡入一次。
  const [instant] = useState(() => hasThumb && peekThumb(photoId) !== null);

  // 卸掉时取消：还没轮到下载的就不下了（手指甩过去的那几百张）。
  useEffect(() => {
    if (!hasThumb || peekThumb(photoId)) return;
    return requestThumb(adminKey, photoId, (url) => setFetched({ id: photoId, url }));
  }, [hasThumb, photoId, adminKey]);

  const url = hasThumb ? peekThumb(photoId) ?? (fetched?.id === photoId ? fetched.url : null) : null;
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
      data-photo-id={photo.id}
      className="group absolute overflow-hidden"
      style={{ top, left, width: cell, height: cell, background: selected ? "var(--color-admin-neutral)" : T.panelAlt }}
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
              className={`pointer-events-none h-full w-full object-cover ${instant ? "" : "transition-opacity duration-150 motion-reduce:transition-none"}`}
              style={{ opacity: instant || loaded ? 1 : 0 }}
            />
          ) : waiting ? null : (
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
