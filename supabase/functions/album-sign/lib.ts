/*
 * album-sign 的纯逻辑：key 编码、URL 构造、预签名、错误映射、请求体校验、S3 XML。
 * 不碰网络、不读环境变量，这样 lib_test.ts 能直接测；装配在 handler.ts / index.ts。
 * 契约见 docs/superpowers/plans/2026-09-25-org-photo-albums.md 「契约 2」。
 */

import { AwsClient } from "npm:aws4fetch@1";
import { createHash } from "node:crypto";

export const MAX_PHOTO_IDS = 500;
// S3 DeleteObjects 单次请求最多 1000 个 key。
export const DELETE_BATCH = 1000;
export const PUT_EXPIRES_SEC = 15 * 60;
export const GET_EXPIRES_SEC = 60 * 60;

/** 业务错误。`error` 就是回给前端的 `{error}`，形如 `CODE` 或 `CODE:detail`。 */
export class FnError extends Error {
  constructor(readonly error: string) {
    super(error);
  }
}

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

export interface Config {
  supabaseUrl: string;
  serviceKey: string;
  r2Endpoint: string;
  /** 写进预签名 URL 给浏览器用的地址；默认同 r2Endpoint。 */
  r2PublicEndpoint: string;
  r2AccessKeyId: string;
  r2SecretAccessKey: string;
  r2Bucket: string;
  r2Region: string;
  allowedOrigins: string[];
}

export type EnvGet = (name: string) => string | undefined;

/** 缺任何一项都返回 null，由调用方回 500 NOT_CONFIGURED——半配置的函数比不能用更危险。 */
export function readConfig(env: EnvGet): Config | null {
  const get = (k: string) => (env(k) ?? "").trim();
  const cfg: Config = {
    supabaseUrl: get("SUPABASE_URL").replace(/\/+$/, ""),
    serviceKey: get("SUPABASE_SERVICE_ROLE_KEY"),
    r2Endpoint: get("R2_ENDPOINT").replace(/\/+$/, ""),
    // 本地函数跑在 Docker 里，要用 host.docker.internal 才连得到宿主机的 MinIO，
    // 但宿主机上的浏览器解析不了这个名字，而 Host 又在签名里、不能事后改。
    // 所以给浏览器的 URL 单独用一个地址签。线上 R2 两者相同，不用设。
    r2PublicEndpoint: (get("R2_PUBLIC_ENDPOINT") || get("R2_ENDPOINT")).replace(/\/+$/, ""),
    r2AccessKeyId: get("R2_ACCESS_KEY_ID"),
    r2SecretAccessKey: get("R2_SECRET_ACCESS_KEY"),
    r2Bucket: get("R2_BUCKET"),
    // R2 固定用 auto；留一个可选覆盖，给要求具体 region 的 S3 兼容服务（本地测试用）。
    r2Region: get("R2_REGION") || "auto",
    allowedOrigins: get("ALLOWED_ORIGINS")
      .split(",")
      .map((s) => s.trim().replace(/\/+$/, ""))
      .filter(Boolean),
  };
  const required = [
    cfg.supabaseUrl,
    cfg.serviceKey,
    cfg.r2Endpoint,
    cfg.r2AccessKeyId,
    cfg.r2SecretAccessKey,
    cfg.r2Bucket,
  ];
  if (required.some((v) => !v) || cfg.allowedOrigins.length === 0) return null;
  return cfg;
}

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

/**
 * 只对白名单 origin 回显 Access-Control-Allow-Origin。永远带 `Vary: Origin`，
 * 否则 CDN 可能把给 A 域名的响应缓存给 B 域名。
 * 注意 CORS 不是鉴权：它只拦浏览器读响应，真正的鉴权是 body 里的 admin_key。
 */
export function corsHeaders(origin: string | null, allowed: string[]): Headers {
  const h = new Headers({ Vary: "Origin" });
  if (origin && allowed.includes(origin)) {
    h.set("Access-Control-Allow-Origin", origin);
    h.set("Access-Control-Allow-Headers", "apikey, authorization, content-type, x-client-info");
    h.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    h.set("Access-Control-Max-Age", "86400");
  }
  return h;
}

// ---------------------------------------------------------------------------
// 错误码 → HTTP 状态
// ---------------------------------------------------------------------------

/** 契约 2 的状态码表；未列出的 RPC 错一律 400，和 PostgREST 的 RAISE → 400 一致。 */
export function errorStatus(error: string): number {
  const code = error.split(":", 1)[0];
  switch (code) {
    case "BAD_KEY":
      return 401;
    case "RATE_LIMITED":
      return 429;
    case "NOT_CONFIGURED":
      return 500;
    case "STORAGE_ERROR":
    case "RPC_UNAVAILABLE":
      return 502;
  }
  // 数据库那边 5xx（挂了、超时）不是调用方的错，别报成 400 让前端以为参数不对。
  if (/^HTTP_5\d\d$/.test(code)) return 502;
  return 400;
}

/**
 * PostgREST 的 message 只有是 `CODE` / `CODE:detail` 形状时才原样转给前端；
 * 其余（Postgres 自带的英文报错、PGRST 错）换成 `HTTP_<status>`，
 * 免得把内部细节漏给浏览器，也让前端的 ERROR_ZH 只需要认大写码。
 */
export function rpcErrorFromResponse(status: number, message: unknown): string {
  if (typeof message === "string" && /^[A-Z][A-Z0-9_]*(:.*)?$/s.test(message)) return message;
  return `HTTP_${status}`;
}

// ---------------------------------------------------------------------------
// 请求体校验
// ---------------------------------------------------------------------------

export type ViewKind = "thumb" | "preview" | "original" | "proxy";

export type SignRequest =
  | {
    action: "upload";
    admin_key: string;
    album_id: string;
    filename: string;
    content_type: string;
    size_bytes: number;
    taken_at: string | null;
  }
  | { action: "complete" | "abort"; admin_key: string; photo_id: string }
  // 视频的低画质版：proxy_upload 签 PUT，传完 proxy_done 核对并标记。
  | { action: "proxy_upload" | "proxy_done"; admin_key: string; photo_id: string }
  | { action: "view"; admin_key: string; kind: ViewKind; photo_ids: string[] }
  | { action: "download"; admin_key: string; photo_ids: string[] }
  | { action: "delete"; admin_key: string; photo_ids: string[] }
  | { action: "delete"; admin_key: string; album_id: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad = () => new FnError("BAD_REQUEST");

function str(v: unknown, max = 1000): string {
  if (typeof v !== "string" || v.length === 0 || v.length > max) throw bad();
  return v;
}
function uuid(v: unknown): string {
  if (typeof v !== "string" || !UUID_RE.test(v)) throw bad();
  return v.toLowerCase();
}
function uuids(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > MAX_PHOTO_IDS) throw bad();
  return [...new Set(v.map(uuid))];
}

/**
 * 只校验形状和类型（坏 uuid 也在这里挡，别让 Postgres 报一句英文 22P02）。
 * 取值范围（文件名长度、大小上限、content_type 前缀）归 RPC 管，报 BAD_FILE——
 * 规则只写一处，免得两边不一致。
 */
export function parseRequest(body: unknown): SignRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw bad();
  const b = body as Record<string, unknown>;
  const admin_key = str(b.admin_key, 200);
  switch (b.action) {
    case "upload": {
      if (typeof b.size_bytes !== "number" || !Number.isSafeInteger(b.size_bytes)) throw bad();
      let taken_at: string | null = null;
      if (b.taken_at !== undefined && b.taken_at !== null) {
        taken_at = str(b.taken_at, 64);
        if (Number.isNaN(Date.parse(taken_at))) throw bad();
      }
      return {
        action: "upload",
        admin_key,
        album_id: uuid(b.album_id),
        filename: str(b.filename),
        content_type: str(b.content_type, 255),
        size_bytes: b.size_bytes,
        taken_at,
      };
    }
    case "complete":
    case "abort":
    case "proxy_upload":
    case "proxy_done":
      return { action: b.action, admin_key, photo_id: uuid(b.photo_id) };
    case "view": {
      if (b.kind !== "thumb" && b.kind !== "preview" && b.kind !== "original" && b.kind !== "proxy") throw bad();
      return { action: "view", admin_key, kind: b.kind, photo_ids: uuids(b.photo_ids) };
    }
    case "download":
      return { action: "download", admin_key, photo_ids: uuids(b.photo_ids) };
    case "delete": {
      // 两种删法二选一；都给或都不给说明调用方搞错了，别猜。
      const hasIds = b.photo_ids !== undefined;
      const hasAlbum = b.album_id !== undefined;
      if (hasIds === hasAlbum) throw bad();
      return hasIds
        ? { action: "delete", admin_key, photo_ids: uuids(b.photo_ids) }
        : { action: "delete", admin_key, album_id: uuid(b.album_id) };
    }
    default:
      throw bad();
  }
}

// ---------------------------------------------------------------------------
// 对象 key 与 URL
// ---------------------------------------------------------------------------

/** 照片前缀必须长这样。RPC 是可信的，但删前缀是危险操作：空前缀 = 整个 bucket。 */
const PREFIX_RE =
  /^orgs\/[0-9a-f-]{36}\/albums\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/$/;

export function assertPhotoPrefix(prefix: string): string {
  if (!PREFIX_RE.test(prefix)) throw new FnError("STORAGE_ERROR");
  return prefix;
}

/** 原片 key 必须落在该照片前缀的 original/ 下，且只有一段文件名。 */
export function assertOriginalKey(prefix: string, key: string): string {
  const name = key.startsWith(prefix + "original/") ? key.slice(prefix.length + 9) : "";
  if (!name || name.includes("/")) throw new FnError("STORAGE_ERROR");
  return key;
}

export const thumbKey = (prefix: string) => prefix + "thumb.jpg";
export const previewKey = (prefix: string) => prefix + "preview.jpg";
/** 视频的 720p 低码率版，灯箱默认播它。 */
export const proxyKey = (prefix: string) => prefix + "proxy.mp4";

/** encodeURIComponent 不编码 `!'()*`，SigV4 要求编码；统一编掉，URL 和签名里的规范路径就是同一个样子。 */
function rfc3986(s: string): string {
  return encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/**
 * 每一段单独编码、保留 `/`。空段、`.`、`..` 直接拒：URL 解析会把 `..` 折叠掉，
 * 签名的路径和真正写入的路径就对不上了（更糟的是可能写到别的前缀下）。
 */
export function encodeKey(key: string): string {
  const parts = key.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) {
    throw new FnError("STORAGE_ERROR");
  }
  return parts.map(rfc3986).join("/");
}

/** path-style：`{endpoint}/{bucket}/{key}`。本地 MinIO 不支持虚拟主机式，R2 两种都支持。 */
export function objectUrl(endpoint: string, bucket: string, key: string): string {
  return `${endpoint.replace(/\/+$/, "")}/${rfc3986(bucket)}/${encodeKey(key)}`;
}

export function bucketUrl(endpoint: string, bucket: string): string {
  return `${endpoint.replace(/\/+$/, "")}/${rfc3986(bucket)}`;
}

/**
 * RFC 6266 / 5987 的 `filename*`。只写 UTF-8 这一种：中文文件名是常态，
 * 所有目标浏览器都认 filename*，就不再放 ASCII 兜底的 filename= 了。
 */
export function contentDisposition(filename: string): string {
  return `attachment; filename*=UTF-8''${rfc3986(filename)}`;
}

export function makeClient(cfg: Pick<Config, "r2AccessKeyId" | "r2SecretAccessKey" | "r2Region">) {
  return new AwsClient({
    accessKeyId: cfg.r2AccessKeyId,
    secretAccessKey: cfg.r2SecretAccessKey,
    service: "s3",
    region: cfg.r2Region,
    // 只有 client.fetch 才会重试；我们自己发请求，这里设 0 避免意外的 10 次重试。
    retries: 0,
  });
}

export interface PresignOpts {
  method: "GET" | "PUT";
  url: string;
  expiresSec: number;
  /** PUT 时签进去；浏览器上传必须带一模一样的 Content-Type，否则 403。 */
  contentType?: string;
  /** 额外的查询参数（如 response-content-disposition），会被签进去，改一个字都失效。 */
  query?: Record<string, string>;
  datetime?: string; // 测试用，固定签名时间
}

export async function presign(client: AwsClient, o: PresignOpts): Promise<string> {
  const u = new URL(o.url);
  u.searchParams.set("X-Amz-Expires", String(o.expiresSec));
  for (const [k, v] of Object.entries(o.query ?? {})) u.searchParams.set(k, v);
  const signed = await client.sign(u.toString(), {
    method: o.method,
    headers: o.contentType ? { "content-type": o.contentType } : undefined,
    // aws4fetch 默认把 content-type 列为「不可签」头；allHeaders 让它进 X-Amz-SignedHeaders。
    // 我们只传了 content-type 一个头，所以不会顺带签进别的东西（Content-Length 不在里面）。
    aws: { signQuery: true, allHeaders: true, datetime: o.datetime },
  });
  // URLSearchParams 把空格序列化成 `+`；S3 兼容服务对查询串里的 `+` 解读不一，
  // 换成 %20 更稳。字面 `+` 已被序列化成 %2B，所以这里的 `+` 只可能是空格。
  const out = new URL(signed.url);
  return `${out.origin}${out.pathname}${out.search.replace(/\+/g, "%20")}`;
}

// ---------------------------------------------------------------------------
// S3 XML
// ---------------------------------------------------------------------------

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function xmlUnescape(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    const l = e.toLowerCase();
    if (l === "amp") return "&";
    if (l === "lt") return "<";
    if (l === "gt") return ">";
    if (l === "quot") return '"';
    if (l === "apos") return "'";
    return String.fromCodePoint(
      l.startsWith("#x") ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10),
    );
  });
}

/** Quiet 模式：成功的 key 不回显，响应里只剩失败项，好判断。 */
export function deleteObjectsXml(keys: string[]): string {
  if (keys.length === 0 || keys.length > DELETE_BATCH) throw new FnError("STORAGE_ERROR");
  const objs = keys.map((k) => `<Object><Key>${xmlEscape(k)}</Key></Object>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Delete xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Quiet>true</Quiet>${objs}</Delete>`;
}

/** DeleteObjects 要求 Content-MD5（base64 的原始 16 字节摘要，不是 hex）。 */
export function md5Base64(body: string): string {
  return createHash("md5").update(body, "utf8").digest("base64");
}

/** DeleteObjects 即使 200 也可能逐个 key 报错；返回失败的 key。 */
export function parseDeleteErrors(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<Error>([\s\S]*?)<\/Error>/g)) {
    const key = m[1].match(/<Key>([\s\S]*?)<\/Key>/);
    out.push(key ? xmlUnescape(key[1]) : "");
  }
  return out;
}

export function parseListObjects(xml: string): { keys: string[]; nextToken: string | null } {
  const keys = [...xml.matchAll(/<Key>([\s\S]*?)<\/Key>/g)].map((m) => xmlUnescape(m[1]));
  const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml);
  const tok = xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/);
  return { keys, nextToken: truncated && tok ? xmlUnescape(tok[1]) : null };
}

export function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}
