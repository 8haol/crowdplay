import { isVideo, type AlbumPhoto } from "./albumTypes";

/*
 * 相册网格的「怎么看」：排序、类型筛选、文件名搜索、缩略图大小，都是纯函数。
 *
 * 状态以 URL 为准（?sort= &type= &q= &size=，和灯箱的 ?p= 并存），好把链接直接发给别的同工；
 * 同时记到 localStorage：排序和大小全局记一份，筛选和搜索按相册各记一份。
 */

export type SortId = "taken-asc" | "taken-desc" | "name-asc" | "name-desc" | "likes" | "uploaded";
// hearted = 任何设备点过（爱心数 > 0）；liked = 这台设备点过。liked 沿用旧 id，旧链接 ?type=liked 意思不变。
export type FilterId = "all" | "photo" | "video" | "hearted" | "liked" | "nothumb";
export type SizeId = "s" | "m" | "l";

export interface ViewState {
  sort: SortId;
  type: FilterId;
  q: string;
  size: SizeId;
}

export const DEFAULT_VIEW: ViewState = { sort: "taken-asc", type: "all", q: "", size: "m" };

export const SORT_OPTIONS: ReadonlyArray<{ id: SortId; label: string }> = [
  { id: "taken-asc", label: "拍摄时间 旧→新" },
  { id: "taken-desc", label: "拍摄时间 新→旧" },
  { id: "name-asc", label: "文件名 A→Z" },
  { id: "name-desc", label: "文件名 Z→A" },
  { id: "likes", label: "最多爱心" },
  { id: "uploaded", label: "最近上传" },
];

export const FILTER_OPTIONS: ReadonlyArray<{ id: FilterId; label: string }> = [
  { id: "all", label: "全部" },
  { id: "photo", label: "照片" },
  { id: "video", label: "视频" },
  { id: "hearted", label: "大家的爱心" },
  { id: "liked", label: "我的爱心" },
  { id: "nothumb", label: "无缩略图" },
];

export const SIZE_OPTIONS: ReadonlyArray<{ id: SizeId; label: string; name: string }> = [
  { id: "s", label: "小", name: "小图" },
  { id: "m", label: "中", name: "中图" },
  { id: "l", label: "大", name: "大图" },
];

const SORTS = new Set<string>(SORT_OPTIONS.map((o) => o.id));
const FILTERS = new Set<string>(FILTER_OPTIONS.map((o) => o.id));
const SIZES = new Set<string>(SIZE_OPTIONS.map((o) => o.id));

export const isGroupedSort = (sort: SortId) => sort === "taken-asc" || sort === "taken-desc";

/* ------------------------------------------------------------ URL + 本地记忆 */

const PARAM = { sort: "sort", type: "type", q: "q", size: "size" } as const;
const GLOBAL_KEY = "album.view";
const albumKey = (albumId: string) => `album.view:${albumId}`;

function readJson(key: string): Record<string, unknown> {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function writeJson(key: string, value: Record<string, unknown>) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 隐私模式 / 存储满了：只是记不住，不影响使用。
  }
}

function pick<T extends string>(value: unknown, allowed: Set<string>): T | undefined {
  return typeof value === "string" && allowed.has(value) ? (value as T) : undefined;
}

/** 上次在这台电脑上的看法。URL 里没写的项用它补。 */
export function loadStoredView(albumId: string): ViewState {
  const global = readJson(GLOBAL_KEY);
  const local = readJson(albumKey(albumId));
  return {
    sort: pick<SortId>(global.sort, SORTS) ?? DEFAULT_VIEW.sort,
    size: pick<SizeId>(global.size, SIZES) ?? DEFAULT_VIEW.size,
    type: pick<FilterId>(local.type, FILTERS) ?? DEFAULT_VIEW.type,
    q: typeof local.q === "string" ? local.q.slice(0, 100) : DEFAULT_VIEW.q,
  };
}

export function saveStoredView(albumId: string, view: ViewState) {
  writeJson(GLOBAL_KEY, { sort: view.sort, size: view.size });
  writeJson(albumKey(albumId), { type: view.type, q: view.q });
}

export function viewFromParams(params: URLSearchParams, fallback: ViewState): ViewState {
  const q = params.get(PARAM.q);
  return {
    sort: pick<SortId>(params.get(PARAM.sort), SORTS) ?? fallback.sort,
    type: pick<FilterId>(params.get(PARAM.type), FILTERS) ?? fallback.type,
    q: q !== null ? q.slice(0, 100) : fallback.q,
    size: pick<SizeId>(params.get(PARAM.size), SIZES) ?? fallback.size,
  };
}

/** 写回 URL：默认值不写，链接保持干净；其它参数（比如 ?p=）原样保留。 */
export function paramsWithView(prev: URLSearchParams, view: ViewState): URLSearchParams {
  const next = new URLSearchParams(prev);
  const set = (key: string, value: string, fallback: string) => {
    if (value && value !== fallback) next.set(key, value);
    else next.delete(key);
  };
  set(PARAM.sort, view.sort, DEFAULT_VIEW.sort);
  set(PARAM.type, view.type, DEFAULT_VIEW.type);
  set(PARAM.q, view.q, DEFAULT_VIEW.q);
  set(PARAM.size, view.size, DEFAULT_VIEW.size);
  return next;
}

/* -------------------------------------------------------------- 排序和筛选 */

/** 自然排序：DSC2 排在 DSC10 前面。 */
const collator = new Intl.Collator(["zh-CN", "en"], { numeric: true, sensitivity: "base" });
export const compareNames = (a: string, b: string) => collator.compare(a, b);

/** 和服务端一样：没有拍摄时间的按上传时间算。 */
export function takenTime(photo: AlbumPhoto): number {
  const t = Date.parse(photo.taken_at ?? photo.created_at);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * 「最多爱心」和两个爱心筛选按上次读取 / 切换视图时的快照算，
 * 在网格或灯箱里点爱心不会让照片在手指下面跳走或消失。
 */
export interface LikeSnapshot {
  votes: ReadonlyMap<string, number>;
  liked: ReadonlySet<string>;
}

export function snapshotLikes(photos: AlbumPhoto[]): LikeSnapshot {
  return {
    votes: new Map(photos.map((p) => [p.id, p.like_count])),
    liked: new Set(photos.filter((p) => p.liked_by_me).map((p) => p.id)),
  };
}

export function sortPhotos(photos: AlbumPhoto[], sort: SortId, snap: LikeSnapshot): AlbumPhoto[] {
  const keyed = photos.map((photo) => ({ photo, taken: takenTime(photo), uploaded: Date.parse(photo.created_at) || 0 }));
  type Row = (typeof keyed)[number];
  const byName = (a: Row, b: Row) => compareNames(a.photo.filename, b.photo.filename) || (a.photo.id < b.photo.id ? -1 : 1);
  const votes = (row: Row) => snap.votes.get(row.photo.id) ?? row.photo.like_count;
  const cmp: Record<SortId, (a: Row, b: Row) => number> = {
    "taken-asc": (a, b) => a.taken - b.taken || byName(a, b),
    "taken-desc": (a, b) => b.taken - a.taken || byName(a, b),
    "name-asc": byName,
    "name-desc": (a, b) => byName(b, a),
    likes: (a, b) => votes(b) - votes(a) || a.taken - b.taken || byName(a, b),
    uploaded: (a, b) => b.uploaded - a.uploaded || byName(a, b),
  };
  return keyed.sort(cmp[sort]).map((row) => row.photo);
}

export function matchesQuery(photo: AlbumPhoto, q: string): boolean {
  const needle = q.trim().toLowerCase();
  return !needle || photo.filename.toLowerCase().includes(needle);
}

export function matchesType(photo: AlbumPhoto, type: FilterId, snap: LikeSnapshot): boolean {
  switch (type) {
    case "all": return true;
    case "photo": return !isVideo(photo);
    case "video": return isVideo(photo);
    case "hearted": return (snap.votes.get(photo.id) ?? 0) > 0;
    case "liked": return snap.liked.has(photo.id);
    case "nothumb": return !photo.has_thumb;
  }
}

export type FilterCounts = Record<FilterId, number>;

/** 每个筛选项的数量，按当前搜索词算。爱心两项数的是此刻的爱心，不是快照。 */
export function countByType(photos: AlbumPhoto[], q: string): FilterCounts {
  const counts: FilterCounts = { all: 0, photo: 0, video: 0, hearted: 0, liked: 0, nothumb: 0 };
  for (const photo of photos) {
    if (!matchesQuery(photo, q)) continue;
    counts.all++;
    if (isVideo(photo)) counts.video++;
    else counts.photo++;
    if (photo.like_count > 0) counts.hearted++;
    if (photo.liked_by_me) counts.liked++;
    if (!photo.has_thumb) counts.nothumb++;
  }
  return counts;
}

export function applyView(photos: AlbumPhoto[], view: ViewState, snap: LikeSnapshot): AlbumPhoto[] {
  const kept = photos.filter((photo) => matchesQuery(photo, view.q) && matchesType(photo, view.type, snap));
  return sortPhotos(kept, view.sort, snap);
}

/* ------------------------------------------------------------ 按天分组 */

export interface DayGroup {
  key: string;
  label: string;
  photos: AlbumPhoto[];
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function dayKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/** 「9月20日 周六」；不是今年的带上年份。 */
export function dayLabel(date: Date): string {
  const year = date.getFullYear() === new Date().getFullYear() ? "" : `${date.getFullYear()}年`;
  return `${year}${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAYS[date.getDay()]}`;
}

/** 已经按拍摄时间排好的列表，按本地日期切成连续的几段。 */
export function groupByDay(photos: AlbumPhoto[]): DayGroup[] {
  const groups: DayGroup[] = [];
  let current: DayGroup | null = null;
  for (const photo of photos) {
    const date = new Date(takenTime(photo));
    const key = dayKey(date);
    if (!current || current.key !== key) {
      current = { key, label: dayLabel(date), photos: [] };
      groups.push(current);
    }
    current.photos.push(photo);
  }
  return groups;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 「9月20日 周六 14:32」，灯箱顶栏用。 */
export function shortDateTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${dayLabel(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 「2026年9月20日 周六 14:32:05」，信息栏用。 */
export function fullDateTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAYS[date.getDay()]} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/* ------------------------------------------------------------ 列数 */

/** 每档的目标格宽和最少列数：桌面中档约 8 列，手机 3 列。 */
const SIZE_SPEC: Record<SizeId, { target: number; min: number }> = {
  s: { target: 100, min: 4 },
  m: { target: 150, min: 3 },
  l: { target: 240, min: 2 },
};

export function columnsFor(width: number, size: SizeId): number {
  const spec = SIZE_SPEC[size];
  return Math.max(spec.min, Math.round(width / spec.target));
}

/* ------------------------------------------------------------ 上传去重 */

/** 同名且字节数一样，就当作同一个文件。 */
export const dedupeKey = (name: string, size: number) => `${name}\u0000${size}`;
