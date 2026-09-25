import { RpcError, rpc } from "../../lib/api";
import { deviceId } from "./deviceId";
import type { AlbumPhoto, AlbumPhotosData, AlbumsData, ViewKind } from "./albumTypes";

/*
 * 相册的两条通道（契约见 docs/superpowers/plans/2026-09-25-org-photo-albums.md）：
 *
 * 1. 元数据和爱心：普通的 admin_album_* RPC，走 lib/api.ts 的 rpc()。
 * 2. 对象存储：album-sign Edge Function 签发 R2 预签名 URL，浏览器拿着 URL
 *    直接 PUT / GET R2。R2 密钥只在函数里。
 */

const BASE = import.meta.env.VITE_SUPABASE_URL as string;
const API_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  import.meta.env.VITE_SUPABASE_ANON_KEY) as string;

/** album-sign 一次最多接受的 photo_ids。 */
export const MAX_BATCH = 500;

export type AlbumAction = "upload" | "complete" | "abort" | "view" | "download" | "delete";

export interface UploadSigned {
  photo_id: string;
  put_original: string;
  put_thumb: string;
  put_preview: string;
}

export interface DownloadLink {
  url: string;
  filename: string;
}

/**
 * POST 到 album-sign。非 200 时把 `{error:"CODE:detail"}` 包成 RpcError，
 * 这样调用方和 RPC 一样走 errorText()；网络失败 / 超时抛 RpcError("NETWORK")。
 *
 * 不自动重试：upload 会登记一行 pending，盲目重试会留下重复的行。
 */
export async function albumSign<T>(
  action: AlbumAction,
  body: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/functions/v1/album-sign`, {
      method: "POST",
      headers: {
        apikey: API_KEY,
        authorization: `Bearer ${API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ action, ...body }),
      signal: ctrl.signal,
    });
    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }
    if (res.ok) {
      if (payload && typeof payload === "object") return payload as T;
      throw new RpcError("NETWORK");
    }
    const raw =
      payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string"
        ? (payload as { error: string }).error
        : `HTTP_${res.status}`;
    throw new RpcError(raw);
  } catch (err) {
    if (err instanceof RpcError) throw err;
    throw new RpcError("NETWORK");
  } finally {
    clearTimeout(timer);
  }
}

function chunks<T>(items: T[], size = MAX_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/* ------------------------------------------------------------------ RPC */

export function fetchAlbums(adminKey: string): Promise<AlbumsData> {
  return rpc<AlbumsData>("admin_albums", { p_admin_key: adminKey });
}

export function createAlbum(adminKey: string, title: string, eventId: string | null): Promise<{ id: string }> {
  return rpc<{ id: string }>("admin_album_create", { p_admin_key: adminKey, p_title: title, p_event_id: eventId });
}

export function renameAlbum(adminKey: string, albumId: string, title: string): Promise<{ id: string; title: string }> {
  return rpc("admin_album_rename", { p_admin_key: adminKey, p_album_id: albumId, p_title: title });
}

export function fetchAlbumPhotos(adminKey: string, albumId: string): Promise<AlbumPhotosData> {
  return rpc<AlbumPhotosData>("admin_album_photos", {
    p_admin_key: adminKey,
    p_album_id: albumId,
    p_device_id: deviceId(),
  });
}

/** 带上想要的结果而不是「切换」：rpc() 遇到网络错误会重试，切换被重试一次就翻回去了。 */
export function togglePhotoLike(adminKey: string, photoId: string, liked: boolean): Promise<{ liked: boolean; like_count: number }> {
  return rpc("admin_photo_like_toggle", { p_admin_key: adminKey, p_photo_id: photoId, p_device_id: deviceId(), p_liked: liked });
}

/* ------------------------------------------------------------ 删除 */

export async function deletePhotos(adminKey: string, photoIds: string[]): Promise<number> {
  let deleted = 0;
  for (const batch of chunks(photoIds)) {
    const result = await albumSign<{ deleted: number }>("delete", { admin_key: adminKey, photo_ids: batch }, 60_000);
    deleted += result.deleted;
  }
  forgetUrls(photoIds);
  return deleted;
}

/** 函数那边分批删对象再删相册；几千张的相册要跑一会儿，给足超时。 */
export function deleteAlbum(adminKey: string, albumId: string): Promise<{ deleted: number }> {
  return albumSign("delete", { admin_key: adminKey, album_id: albumId }, 180_000);
}

/* ------------------------------------------------------- 签名 URL 缓存 */

/*
 * GET URL 签 1 小时，这里只信 50 分钟，给「拿到 URL 到浏览器真正发请求」留余量。
 * 按 `kind:photoId` 缓存；null 也缓存（这张确实没有这种图），免得网格反复去要。
 * photo id 是 UUID，跨机构不会撞，所以缓存不必按口令分开。
 */
const TTL_MS = 50 * 60 * 1000;
const cache = new Map<string, { url: string | null; at: number }>();

const cacheKey = (kind: ViewKind, photoId: string) => `${kind}:${photoId}`;

/** 同步读：已经拿到手且没过期的 URL，否则 null。 */
export function peekUrl(kind: ViewKind, photoId: string): string | null {
  const hit = cache.get(cacheKey(kind, photoId));
  return hit && Date.now() - hit.at < TTL_MS ? hit.url : null;
}

export function forgetUrls(photoIds: string[]) {
  for (const id of photoIds) {
    for (const kind of ["thumb", "preview", "original"] as const) cache.delete(cacheKey(kind, id));
  }
}

/*
 * 批量取：同一帧里要的 id 攒起来，一次 view 请求（每批 ≤500）。网格滚动时
 * IntersectionObserver 一次报进来几十格，这样只打一两次函数，而不是几十次。
 */
type Waiter = (url: string | null) => void;
const pending = new Map<string, { adminKey: string; kind: ViewKind; waiters: Map<string, Waiter[]> }>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function viewUrl(adminKey: string, photoId: string, kind: ViewKind): Promise<string | null> {
  const hit = cache.get(cacheKey(kind, photoId));
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.url);
  return new Promise((resolve) => {
    const bucketKey = `${kind}\u0000${adminKey}`;
    let bucket = pending.get(bucketKey);
    if (!bucket) {
      bucket = { adminKey, kind, waiters: new Map() };
      pending.set(bucketKey, bucket);
    }
    const list = bucket.waiters.get(photoId);
    if (list) list.push(resolve);
    else bucket.waiters.set(photoId, [resolve]);
    // 用 setTimeout 而不是 requestAnimationFrame：后台标签页里 rAF 不跑，
    // 下载之类不看画面的调用方会被卡住。16ms 就是「一帧」。
    flushTimer ??= setTimeout(flush, 16);
  });
}

/** 按照片的 has_thumb / has_preview 先挡掉肯定没有的，省一次请求。 */
export function photoUrl(adminKey: string, photo: AlbumPhoto, kind: ViewKind): Promise<string | null> {
  if (kind === "thumb" && !photo.has_thumb) return Promise.resolve(null);
  if (kind === "preview" && !photo.has_preview) return Promise.resolve(null);
  return viewUrl(adminKey, photo.id, kind);
}

function flush() {
  flushTimer = null;
  const buckets = [...pending.values()];
  pending.clear();
  for (const bucket of buckets) {
    for (const ids of chunks([...bucket.waiters.keys()])) {
      albumSign<{ urls: Record<string, string> }>("view", {
        admin_key: bucket.adminKey,
        kind: bucket.kind,
        photo_ids: ids,
      }).then(
        (result) => {
          const now = Date.now();
          for (const id of ids) {
            const url = result.urls?.[id] ?? null;
            cache.set(cacheKey(bucket.kind, id), { url, at: now });
            for (const done of bucket.waiters.get(id) ?? []) done(url);
          }
        },
        () => {
          // 失败不缓存：下次进入可视区域会再要一次。
          for (const id of ids) for (const done of bucket.waiters.get(id) ?? []) done(null);
        },
      );
    }
  }
}

/** 原片下载 URL（带 attachment）。按 500 一批顺序要，合并成一张表。 */
export async function downloadLinks(adminKey: string, photoIds: string[]): Promise<Record<string, DownloadLink>> {
  const out: Record<string, DownloadLink> = {};
  for (const batch of chunks(photoIds)) {
    const result = await albumSign<{ urls: Record<string, DownloadLink> }>("download", {
      admin_key: adminKey,
      photo_ids: batch,
    });
    Object.assign(out, result.urls ?? {});
  }
  return out;
}
