/*
 * album-sign 的请求处理。fetch 与 env 从外面注入：生产里是全局 fetch / Deno.env，
 * 测试里换成假的，不用起 Supabase 和 R2 就能跑完整流程。
 */

import type { AwsClient } from "npm:aws4fetch@1";
import {
  assertOriginalKey,
  assertPhotoPrefix,
  bucketUrl,
  chunk,
  type Config,
  contentDisposition,
  corsHeaders,
  DELETE_BATCH,
  deleteObjectsXml,
  type EnvGet,
  errorStatus,
  FnError,
  GET_EXPIRES_SEC,
  makeClient,
  MAX_PHOTO_IDS,
  md5Base64,
  objectUrl,
  parseDeleteErrors,
  parseListObjects,
  parseRequest,
  presign,
  previewKey,
  readConfig,
  PUT_EXPIRES_SEC,
  rpcErrorFromResponse,
  type SignRequest,
  thumbKey,
} from "./lib.ts";

export interface Deps {
  fetch: typeof fetch;
  env: EnvGet;
  /** 固定签名时间，给测试断言用。 */
  datetime?: () => string;
}

interface PhotoObject {
  photo_id: string;
  status: "pending" | "ready";
  prefix: string;
  original_key: string;
  filename: string;
  content_type: string;
  has_thumb: boolean;
  has_preview: boolean;
}

const RPC_TIMEOUT_MS = 15_000;
const STORAGE_TIMEOUT_MS = 30_000;

function json(status: number, body: unknown, cors: Headers): Response {
  const h = new Headers(cors);
  h.set("content-type", "application/json; charset=utf-8");
  h.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status, headers: h });
}

export function makeHandler(deps: Deps): (req: Request) => Promise<Response> {
  return async (req) => {
    const cfg = readConfig(deps.env);
    const cors = corsHeaders(req.headers.get("origin"), cfg?.allowedOrigins ?? []);
    if (!cfg) {
      console.error("album-sign: missing env (R2_* / ALLOWED_ORIGINS / SUPABASE_*)");
      return json(500, { error: "NOT_CONFIGURED" }, cors);
    }
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return json(405, { error: "BAD_REQUEST" }, cors);

    try {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        throw new FnError("BAD_REQUEST");
      }
      const parsed = parseRequest(body);
      const ctx = new Ctx(cfg, deps);
      return json(200, await ctx.run(parsed), cors);
    } catch (e) {
      if (e instanceof FnError) return json(errorStatus(e.error), { error: e.error }, cors);
      console.error("album-sign: unexpected", e);
      return json(500, { error: "INTERNAL" }, cors);
    }
  };
}

/** 一次请求的上下文：配置 + 签名客户端 + 注入的 fetch。 */
class Ctx {
  private client: AwsClient;

  constructor(private cfg: Config, private deps: Deps) {
    this.client = makeClient(cfg);
  }

  run(r: SignRequest): Promise<unknown> {
    switch (r.action) {
      case "upload":
        return this.upload(r);
      case "complete":
        return this.complete(r.admin_key, r.photo_id);
      case "abort":
        return this.abort(r.admin_key, r.photo_id);
      case "view":
        return this.view(r.admin_key, r.kind, r.photo_ids);
      case "download":
        return this.download(r.admin_key, r.photo_ids);
      case "delete":
        return "album_id" in r
          ? this.deleteAlbum(r.admin_key, r.album_id)
          : this.deletePhotos(r.admin_key, r.photo_ids);
    }
  }

  // -------------------------------------------------------------------------
  // actions
  // -------------------------------------------------------------------------

  private async upload(r: Extract<SignRequest, { action: "upload" }>) {
    const res = await this.rpc<{
      photo_id: string;
      prefix: string;
      original_key: string;
      stale_prefixes: string[] | null;
    }>("album_reserve_upload", {
      p_admin_key: r.admin_key,
      p_album_id: r.album_id,
      p_filename: r.filename,
      p_content_type: r.content_type,
      p_size_bytes: r.size_bytes,
      p_taken_at: r.taken_at,
    });

    // 过期 pending 的行已经在 RPC 里删掉并提交了，对象只能在这里清。
    // 清失败也不拦这次上传：拦了孤儿对象照样在，还白白让用户重传；记日志，事后可按前缀补删。
    for (const stale of res.stale_prefixes ?? []) {
      try {
        await this.deletePrefix(stale);
      } catch (e) {
        console.error("album-sign: stale prefix cleanup failed", stale, e);
      }
    }

    // 路径只来自 RPC（服务端安全化过的文件名），客户端的 filename 不参与拼 URL。
    const prefix = assertPhotoPrefix(res.prefix);
    const originalKey = assertOriginalKey(prefix, res.original_key);
    const put = (key: string, contentType: string) =>
      this.sign("PUT", key, PUT_EXPIRES_SEC, { contentType });
    const [put_original, put_thumb, put_preview] = await Promise.all([
      put(originalKey, r.content_type),
      put(thumbKey(prefix), "image/jpeg"),
      put(previewKey(prefix), "image/jpeg"),
    ]);
    return { photo_id: res.photo_id, put_original, put_thumb, put_preview };
  }

  private async complete(adminKey: string, photoId: string) {
    const obj = (await this.objectsFor(adminKey, [photoId]))[0];
    if (!obj) throw new FnError("PHOTO_NOT_FOUND");
    // 已经 ready 就别再 HEAD 三次了；RPC 本身也是幂等的。
    if (obj.status === "ready") {
      return { photo_id: obj.photo_id, has_thumb: obj.has_thumb, has_preview: obj.has_preview };
    }

    const prefix = assertPhotoPrefix(obj.prefix);
    const [size, thumb, preview] = await Promise.all([
      this.head(assertOriginalKey(prefix, obj.original_key)),
      this.head(thumbKey(prefix)),
      this.head(previewKey(prefix)),
    ]);
    try {
      await this.rpc("album_complete_upload", {
        p_admin_key: adminKey,
        p_photo_id: obj.photo_id,
        // 原片不存在当作 0 字节：RPC 会判 ALBUM_SIZE_MISMATCH，下面再删行，不会留一条「ready 但没文件」。
        p_actual_size: size ?? 0,
        p_has_thumb: thumb !== null,
        p_has_preview: preview !== null,
      });
    } catch (e) {
      if (e instanceof FnError && e.error.startsWith("ALBUM_SIZE_MISMATCH")) {
        // RPC 抛异常会回滚，行还是 pending，所以清理归这里：先删对象、再删行。
        // 对象删失败就别删行——留着 pending 行，前端随后的 abort 或 24h 后的 stale 清理还能找到它；
        // 反过来先删行，对象就成了谁也找不到、也不计额度的孤儿。清理失败只记日志，错误照原样回。
        try {
          await this.deleteKeys(keysOf(obj));
          await this.rpc("album_delete_photos", {
            p_admin_key: adminKey,
            p_photo_ids: [obj.photo_id],
          });
        } catch (err) {
          console.error("album-sign: cleanup after size mismatch failed", obj.prefix, err);
        }
      }
      throw e;
    }
    return { photo_id: obj.photo_id, has_thumb: thumb !== null, has_preview: preview !== null };
  }

  private async abort(adminKey: string, photoId: string) {
    const obj = (await this.objectsFor(adminKey, [photoId]))[0];
    // 找不到（已被清理 / 不是本机构的）或已 ready：什么都不做。abort 要能放心重复调。
    if (!obj || obj.status !== "pending") return { ok: true };
    // 先删对象再删行：对象删失败时行还在，24h 后会作为 stale 前缀被再清一次。
    await this.deleteKeys(keysOf(obj));
    await this.rpc("album_delete_photos", { p_admin_key: adminKey, p_photo_ids: [obj.photo_id] });
    return { ok: true };
  }

  private async view(adminKey: string, kind: "thumb" | "preview" | "original", ids: string[]) {
    const objs = await this.objectsFor(adminKey, ids);
    const urls: Record<string, string> = {};
    await Promise.all(
      objs.filter((o) => o.status === "ready").map(async (o) => {
        let key: string | null = null;
        const prefix = assertPhotoPrefix(o.prefix);
        if (kind === "original") key = assertOriginalKey(prefix, o.original_key);
        else if (kind === "thumb" && o.has_thumb) key = thumbKey(prefix);
        else if (kind === "preview" && o.has_preview) key = previewKey(prefix);
        // original 不带 attachment：灯箱里的 <video> 要能直接播。
        if (key) urls[o.photo_id] = await this.sign("GET", key, GET_EXPIRES_SEC);
      }),
    );
    return { urls };
  }

  private async download(adminKey: string, ids: string[]) {
    const objs = await this.objectsFor(adminKey, ids);
    const urls: Record<string, { url: string; filename: string }> = {};
    await Promise.all(
      objs.filter((o) => o.status === "ready").map(async (o) => {
        const key = assertOriginalKey(assertPhotoPrefix(o.prefix), o.original_key);
        const url = await this.sign("GET", key, GET_EXPIRES_SEC, {
          query: { "response-content-disposition": contentDisposition(o.filename) },
        });
        urls[o.photo_id] = { url, filename: o.filename };
      }),
    );
    return { urls };
  }

  private async deletePhotos(adminKey: string, ids: string[]) {
    if (ids.length === 0) return { deleted: 0 };
    return { deleted: await this.deleteBatch(adminKey, ids) };
  }

  /** 分批删：每批 ≤500 张，避免一次请求里几千个 key 把函数跑超时。 */
  private async deleteAlbum(adminKey: string, albumId: string) {
    let deleted = 0;
    for (;;) {
      const { photo_ids } = await this.rpc<{ photo_ids: string[] }>("album_photo_ids", {
        p_admin_key: adminKey,
        p_album_id: albumId,
        p_limit: MAX_PHOTO_IDS,
      });
      if (!photo_ids?.length) break;
      const n = await this.deleteBatch(adminKey, photo_ids);
      // 一张都没删掉却还有 id，说明 RPC 之间对不上；停下来，别死循环。
      if (n === 0) throw new FnError("STORAGE_ERROR");
      deleted += n;
    }
    await this.rpc("album_delete", { p_admin_key: adminKey, p_album_id: albumId });
    return { deleted };
  }

  /** 对象先删、行后删：对象删失败就抛 502，行还在，用户重试即可，不会留孤儿。 */
  private async deleteBatch(adminKey: string, ids: string[]): Promise<number> {
    const objs = await this.objectsFor(adminKey, ids);
    if (objs.length === 0) return 0;
    await this.deleteKeys(objs.flatMap(keysOf));
    const { deleted } = await this.rpc<{ deleted: number }>("album_delete_photos", {
      p_admin_key: adminKey,
      p_photo_ids: objs.map((o) => o.photo_id),
    });
    return deleted ?? 0;
  }

  // -------------------------------------------------------------------------
  // RPC
  // -------------------------------------------------------------------------

  private async objectsFor(adminKey: string, ids: string[]): Promise<PhotoObject[]> {
    const res = await this.rpc<{ objects: PhotoObject[] | null }>("album_objects_for", {
      p_admin_key: adminKey,
      p_photo_ids: ids,
    });
    return res.objects ?? [];
  }

  /** 和 web/src/lib/api.ts 同样的薄封装，只是换成 service role key。不引 supabase-js。 */
  private async rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
    const key = this.cfg.serviceKey;
    const headers: Record<string, string> = { apikey: key, "content-type": "application/json" };
    // 旧式 service_role key 是 JWT，要同时放进 Authorization；新式 sb_secret_ 只认 apikey 头。
    if (key.startsWith("ey")) headers.authorization = `Bearer ${key}`;
    let res: Response;
    try {
      res = await this.deps.fetch(`${this.cfg.supabaseUrl}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers,
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
      });
    } catch (e) {
      console.error(`album-sign: rpc ${fn} unreachable`, e);
      throw new FnError("RPC_UNAVAILABLE");
    }
    if (res.ok) {
      const data = (await res.json()) as T & { _error?: string; _detail?: string };
      if (data && typeof data === "object" && data._error) {
        throw new FnError(`${data._error}${data._detail ? `:${data._detail}` : ""}`);
      }
      return data;
    }
    let message: unknown;
    try {
      message = ((await res.json()) as { message?: unknown }).message;
    } catch {
      // 非 JSON 的错误体，按 HTTP_<status> 处理
    }
    const error = rpcErrorFromResponse(res.status, message);
    if (error.startsWith("HTTP_")) console.error(`album-sign: rpc ${fn} ${res.status}`, message);
    throw new FnError(error);
  }

  // -------------------------------------------------------------------------
  // R2（S3 兼容）
  // -------------------------------------------------------------------------

  private sign(
    method: "GET" | "PUT",
    key: string,
    expiresSec: number,
    extra: { contentType?: string; query?: Record<string, string> } = {},
  ): Promise<string> {
    return presign(this.client, {
      method,
      url: objectUrl(this.cfg.r2PublicEndpoint, this.cfg.r2Bucket, key),
      expiresSec,
      ...extra,
      datetime: this.deps.datetime?.(),
    });
  }

  /** 带 SigV4 头发一次请求；网络错和 5xx 都算 STORAGE_ERROR。 */
  private async s3(url: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      const signed = await this.client.sign(url, init);
      res = await this.deps.fetch(signed, { signal: AbortSignal.timeout(STORAGE_TIMEOUT_MS) });
    } catch (e) {
      console.error("album-sign: storage unreachable", init.method, url, e);
      throw new FnError("STORAGE_ERROR");
    }
    return res;
  }

  /** 返回对象大小；不存在返回 null。 */
  private async head(key: string): Promise<number | null> {
    const res = await this.s3(objectUrl(this.cfg.r2Endpoint, this.cfg.r2Bucket, key), {
      method: "HEAD",
    });
    await res.body?.cancel();
    if (res.status === 404) return null;
    if (!res.ok) {
      console.error("album-sign: HEAD failed", res.status, key);
      throw new FnError("STORAGE_ERROR");
    }
    const len = Number(res.headers.get("content-length"));
    return Number.isFinite(len) ? len : 0;
  }

  private async deleteKeys(keys: string[]): Promise<void> {
    for (const batch of chunk(keys, DELETE_BATCH)) {
      const xml = deleteObjectsXml(batch);
      const res = await this.s3(`${bucketUrl(this.cfg.r2Endpoint, this.cfg.r2Bucket)}?delete`, {
        method: "POST",
        headers: { "content-type": "application/xml", "content-md5": md5Base64(xml) },
        body: xml,
      });
      const text = await res.text();
      const failed = res.ok ? parseDeleteErrors(text) : [];
      if (!res.ok || failed.length) {
        console.error("album-sign: DeleteObjects failed", res.status, failed, text.slice(0, 500));
        throw new FnError("STORAGE_ERROR");
      }
    }
  }

  /** 原片文件名这里不知道（行已经没了），只能按前缀列出来再批量删。 */
  private async deletePrefix(prefix: string): Promise<void> {
    assertPhotoPrefix(prefix);
    let token: string | null = null;
    do {
      const u = new URL(bucketUrl(this.cfg.r2Endpoint, this.cfg.r2Bucket));
      u.searchParams.set("list-type", "2");
      u.searchParams.set("prefix", prefix);
      if (token) u.searchParams.set("continuation-token", token);
      const res = await this.s3(u.toString(), { method: "GET" });
      const text = await res.text();
      if (!res.ok) {
        console.error("album-sign: ListObjectsV2 failed", res.status, text.slice(0, 500));
        throw new FnError("STORAGE_ERROR");
      }
      const page = parseListObjects(text);
      // 双保险：只删真的落在这个前缀下的 key。
      const keys = page.keys.filter((k) => k.startsWith(prefix));
      if (keys.length) await this.deleteKeys(keys);
      token = page.nextToken;
    } while (token);
  }
}

/** 一张照片的全部对象。thumb / preview 不看 has_*：pending 时它们可能已经传上去了，删不存在的 key 也不报错。 */
function keysOf(o: PhotoObject): string[] {
  const prefix = assertPhotoPrefix(o.prefix);
  return [assertOriginalKey(prefix, o.original_key), thumbKey(prefix), previewKey(prefix)];
}
