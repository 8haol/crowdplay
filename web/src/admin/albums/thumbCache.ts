import { viewUrl } from "./albumApi";

/*
 * 缩略图按照片 id 缓存，不按 URL。
 *
 * 签名 URL 每签一次都不一样（带签名时间），浏览器的 HTTP 缓存按完整 URL 认，
 * 所以以前每次重新打开相册，几百张缩略图都要重新下一遍。这里下过一次就按 id
 * 存进 Cache Storage，之后隔天再开也直接从本地读，签名 URL 仍然只活 1 小时。
 *
 * 三层：
 * 1. 内存：最近用过的 MEMORY_MAX 张的 blob: URL，同步可读（peekThumb），格子重新挂上时不闪。
 * 2. Cache Storage：按 id 存的 JPEG，跨会话。拿不到（隐私模式、非 https）就跳过这层。
 * 3. 网络：先要签名 URL（albumApi 会把同一帧里的 id 攒成一批），再 fetch。
 *    同时最多 MAX_FETCH 个，后要的先下（LIFO）：手指一路甩过去时先下停下来那一屏；
 *    轮到时已经没人要了（格子滑走、卸掉了）就不下。
 *
 * 缩略图生成后不会再变（对象路径含 photo id，删了就没了），所以缓存永不过期，
 * 只在删照片时清掉。fetch 失败（比如 CORS 没配这个来源）就退回直接用签名 URL。
 */

const CACHE_NAME = "album-thumbs-v1";
const MEMORY_MAX = 600;
const MAX_FETCH = 6;
const SIGN_DELAY_MS = 120;
/** 退回用的签名 URL 签 1 小时，只信 50 分钟（和 albumApi 一致）。 */
const SIGNED_TTL_MS = 50 * 60 * 1000;

type Done = (url: string | null) => void;

/** id → blob: URL（或 fetch 失败时退回的签名 URL）。Map 的插入顺序就是 LRU 顺序。 */
interface Entry { url: string; blob: boolean; at: number }
const memory = new Map<string, Entry>();
/** 正在解析的 id → 等结果的回调。回调集合空了就是没人要了。 */
const inflight = new Map<string, Set<Done>>();
/** 等着下载的：签名 URL 已经拿到，排队等并发名额。 */
const fetchStack: Array<{ id: string; url: string }> = [];
let fetching = 0;

let cachePromise: Promise<Cache | null> | null = null;
function openCache(): Promise<Cache | null> {
  cachePromise ??= (async () => {
    try {
      return typeof caches === "undefined" ? null : await caches.open(CACHE_NAME);
    } catch {
      return null;
    }
  })();
  return cachePromise;
}

/** Cache Storage 的键只是个同源假地址，从来不会真的去请求它。 */
const keyFor = (id: string) => new Request(`${location.origin}/__album-thumb/${encodeURIComponent(id)}`);

function remember(id: string, url: string, blob: boolean) {
  const old = memory.get(id);
  if (old && old.url !== url && old.blob) URL.revokeObjectURL(old.url);
  memory.delete(id);
  memory.set(id, { url, blob, at: Date.now() });
  while (memory.size > MEMORY_MAX) {
    const [oldestId, oldest] = memory.entries().next().value as [string, Entry];
    memory.delete(oldestId);
    if (oldest.blob) URL.revokeObjectURL(oldest.url);
  }
}

function settle(id: string, url: string | null) {
  const waiters = inflight.get(id);
  inflight.delete(id);
  for (const done of waiters ?? []) done(url);
}

/** 同步读：内存里有就给，并把它挪到 LRU 最新的一头。 */
export function peekThumb(id: string): string | null {
  const hit = memory.get(id);
  if (!hit) return null;
  memory.delete(id);
  if (!hit.blob && Date.now() - hit.at >= SIGNED_TTL_MS) return null;
  memory.set(id, hit);
  return hit.url;
}

/**
 * 要一张缩略图。拿到就调 done（没有缩略图或彻底失败给 null）。
 * 返回取消函数：格子卸掉时调用，还没开始下载的就不下了。
 */
export function requestThumb(adminKey: string, id: string, done: Done): () => void {
  const hit = peekThumb(id);
  if (hit) {
    done(hit);
    return () => undefined;
  }
  let waiters = inflight.get(id);
  if (waiters) {
    waiters.add(done);
  } else {
    waiters = new Set([done]);
    inflight.set(id, waiters);
    void resolve(adminKey, id);
  }
  const mine = waiters;
  return () => { mine.delete(done); };
}

/** Promise 版，给灯箱和相册封面用。 */
export function loadThumb(adminKey: string, id: string): Promise<string | null> {
  return new Promise((done) => { requestThumb(adminKey, id, done); });
}

async function resolve(adminKey: string, id: string) {
  const cache = await openCache();
  if (cache) {
    try {
      const res = await cache.match(keyFor(id));
      if (res) {
        const url = URL.createObjectURL(await res.blob());
        remember(id, url, true);
        settle(id, url);
        return;
      }
    } catch {
      // 读缓存出错就当没缓存，走网络
    }
  }
  // 本地没有：稍等一下再要签名。手指甩过去时一闪而过的格子等不到这时候就卸掉了，
  // 没人要就连签名都不要（每批签名是一次 Edge Function 调用）。
  await new Promise((done) => setTimeout(done, SIGN_DELAY_MS));
  if (!inflight.get(id)?.size) {
    inflight.delete(id);
    return;
  }
  const signed = await viewUrl(adminKey, id, "thumb");
  if (!signed) {
    settle(id, null);
    return;
  }
  fetchStack.push({ id, url: signed });
  pump();
}

function pump() {
  while (fetching < MAX_FETCH && fetchStack.length > 0) {
    const next = fetchStack.pop()!;
    if (!inflight.get(next.id)?.size) {
      inflight.delete(next.id);
      continue;
    }
    fetching++;
    void download(next.id, next.url).finally(() => {
      fetching--;
      pump();
    });
  }
}

async function download(id: string, signed: string) {
  try {
    const res = await fetch(signed, { mode: "cors", credentials: "omit" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const cache = await openCache();
    if (cache) {
      const type = blob.type || "image/jpeg";
      cache.put(keyFor(id), new Response(blob, { headers: { "content-type": type } })).catch(() => undefined);
    }
    const url = URL.createObjectURL(blob);
    remember(id, url, true);
    settle(id, url);
  } catch {
    // 退回直接用签名 URL：至少这一小时里照样能显示，只是不进持久缓存。
    remember(id, signed, false);
    settle(id, signed);
  }
}

/** 删照片后调用：内存和 Cache Storage 里的都清掉。 */
export function forgetThumbs(ids: string[]) {
  for (const id of ids) {
    const hit = memory.get(id);
    memory.delete(id);
    if (hit?.blob) URL.revokeObjectURL(hit.url);
  }
  void openCache().then((cache) => {
    if (!cache) return;
    for (const id of ids) cache.delete(keyFor(id)).catch(() => undefined);
  });
}
