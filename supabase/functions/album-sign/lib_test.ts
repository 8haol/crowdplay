// deno test supabase/functions/album-sign/
import assert from "node:assert/strict";
import {
  assertOriginalKey,
  assertPhotoPrefix,
  contentDisposition,
  corsHeaders,
  deleteObjectsXml,
  encodeKey,
  errorStatus,
  FnError,
  makeClient,
  md5Base64,
  objectUrl,
  parseDeleteErrors,
  parseListObjects,
  parseRequest,
  presign,
  readConfig,
  rpcErrorFromResponse,
  xmlUnescape,
} from "./lib.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const ALBUM = "22222222-2222-4222-8222-222222222222";
const PHOTO = "33333333-3333-4333-8333-333333333333";
const PREFIX = `orgs/${ORG}/albums/${ALBUM}/${PHOTO}/`;
const client = makeClient({ r2AccessKeyId: "AKID", r2SecretAccessKey: "SECRET", r2Region: "auto" });
const DT = "20260925T010203Z";

function throwsCode(fn: () => unknown, code: string) {
  assert.throws(fn, (e: unknown) => e instanceof FnError && e.error === code);
}

// ---------------------------------------------------------------------------
// key 编码 / URL
// ---------------------------------------------------------------------------

Deno.test("encodeKey：中文、空格、#、?、+、括号逐段编码，保留 /", () => {
  const key = `${PREFIX}original/园游会 #1?(终)+'.jpg`;
  assert.equal(
    encodeKey(key),
    `${PREFIX}original/%E5%9B%AD%E6%B8%B8%E4%BC%9A%20%231%3F%28%E7%BB%88%29%2B%27.jpg`,
  );
  // # 和 ? 若没编码，会被 URL 当成 fragment / query，路径就被截断了。
  const u = new URL(objectUrl("https://r2.test", "bkt", key));
  assert.equal(u.search, "");
  assert.equal(u.hash, "");
  assert.equal(decodeURIComponent(u.pathname), `/bkt/${key}`);
});

Deno.test("encodeKey：空段、. 和 .. 一律拒绝", () => {
  for (const k of ["a//b", "a/../b", "a/./b", "/a", "a/"]) throwsCode(() => encodeKey(k), "STORAGE_ERROR");
});

Deno.test("objectUrl：path-style，endpoint 结尾斜杠会被去掉", () => {
  assert.equal(objectUrl("http://host.docker.internal:9000/", "albums", "a/b.jpg"), "http://host.docker.internal:9000/albums/a/b.jpg");
});

Deno.test("assertPhotoPrefix / assertOriginalKey：只认服务端生成的形状", () => {
  assert.equal(assertPhotoPrefix(PREFIX), PREFIX);
  for (const p of ["", "orgs/", `${PREFIX}x/`, PREFIX.slice(0, -1)]) throwsCode(() => assertPhotoPrefix(p), "STORAGE_ERROR");
  assert.equal(assertOriginalKey(PREFIX, `${PREFIX}original/a.jpg`), `${PREFIX}original/a.jpg`);
  for (const k of [`${PREFIX}original/`, `${PREFIX}original/a/b.jpg`, `${PREFIX}thumb.jpg`, "orgs/x/original/a.jpg"]) {
    throwsCode(() => assertOriginalKey(PREFIX, k), "STORAGE_ERROR");
  }
});

// ---------------------------------------------------------------------------
// 预签名
// ---------------------------------------------------------------------------

Deno.test("presign PUT：path-style、X-Amz-Expires、签名，且 Content-Type 进了 SignedHeaders", async () => {
  const key = `${PREFIX}original/园游会 #1?.jpg`;
  const url = await presign(client, {
    method: "PUT",
    url: objectUrl("https://acc.r2.cloudflarestorage.com", "lifepassport-albums", key),
    expiresSec: 900,
    contentType: "image/jpeg",
    datetime: DT,
  });
  const u = new URL(url);
  assert.equal(u.origin, "https://acc.r2.cloudflarestorage.com");
  assert.equal(u.pathname, `/lifepassport-albums/${encodeKey(key)}`);
  assert.equal(u.searchParams.get("X-Amz-Expires"), "900");
  assert.equal(u.searchParams.get("X-Amz-Algorithm"), "AWS4-HMAC-SHA256");
  assert.equal(u.searchParams.get("X-Amz-Credential"), "AKID/20260925/auto/s3/aws4_request");
  assert.match(u.searchParams.get("X-Amz-Signature") ?? "", /^[0-9a-f]{64}$/);
  // aws4fetch 默认不签 content-type；这里断言 allHeaders 生效，且没有顺带签 content-length。
  assert.equal(u.searchParams.get("X-Amz-SignedHeaders"), "content-type;host");
});

Deno.test("presign PUT：Content-Type 真的参与了签名（换类型签名就变）", async () => {
  const base = { method: "PUT" as const, url: "https://r2.test/b/k.jpg", expiresSec: 900, datetime: DT };
  const sig = async (ct: string) =>
    new URL(await presign(client, { ...base, contentType: ct })).searchParams.get("X-Amz-Signature");
  assert.equal(await sig("image/jpeg"), await sig("image/jpeg"));
  assert.notEqual(await sig("image/jpeg"), await sig("image/png"));
});

Deno.test("presign GET：不带 Content-Type 时只签 host", async () => {
  const url = await presign(client, { method: "GET", url: "https://r2.test/b/k.jpg", expiresSec: 3600, datetime: DT });
  const u = new URL(url);
  assert.equal(u.searchParams.get("X-Amz-SignedHeaders"), "host");
  assert.equal(u.searchParams.get("X-Amz-Expires"), "3600");
});

Deno.test("download URL：带 response-content-disposition（UTF-8 文件名），查询串里没有 +", async () => {
  const name = "园游会 合影 (1)'s.JPG";
  const url = await presign(client, {
    method: "GET",
    url: objectUrl("https://r2.test", "b", `${PREFIX}original/x.jpg`),
    expiresSec: 3600,
    query: { "response-content-disposition": contentDisposition(name) },
    datetime: DT,
  });
  const u = new URL(url);
  const cd = u.searchParams.get("response-content-disposition");
  assert.equal(cd, `attachment; filename*=UTF-8''${encodeURIComponent(name).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())}`);
  assert.ok(cd?.startsWith("attachment; filename*=UTF-8''%E5%9B%AD"));
  assert.ok(!u.search.includes("+"), "空格要编成 %20，别让 S3 兼容服务去猜 +");
  assert.match(u.searchParams.get("X-Amz-Signature") ?? "", /^[0-9a-f]{64}$/);
});

// ---------------------------------------------------------------------------
// 错误映射
// ---------------------------------------------------------------------------

Deno.test("errorStatus：契约 2 的状态码", () => {
  const cases: [string, number][] = [
    ["BAD_KEY", 401],
    ["RATE_LIMITED", 429],
    ["ALBUM_QUOTA_EXCEEDED:123", 413],
    ["ALBUM_QUOTA_EXCEEDED", 413],
    ["STORAGE_ERROR", 502],
    ["NOT_CONFIGURED", 500],
    ["BAD_REQUEST", 400],
    ["ALBUM_NOT_FOUND", 400],
    ["ALBUM_SIZE_MISMATCH", 400],
    ["BAD_FILE", 400],
    ["HTTP_404", 400],
    ["HTTP_503", 502],
    ["RPC_UNAVAILABLE", 502],
  ];
  for (const [code, status] of cases) assert.equal(errorStatus(code), status, code);
});

Deno.test("rpcErrorFromResponse：只转发 CODE / CODE:detail 形状的 message", () => {
  assert.equal(rpcErrorFromResponse(400, "ALBUM_QUOTA_EXCEEDED:123"), "ALBUM_QUOTA_EXCEEDED:123");
  assert.equal(rpcErrorFromResponse(400, "BAD_KEY"), "BAD_KEY");
  assert.equal(rpcErrorFromResponse(400, 'invalid input syntax for type uuid: "x"'), "HTTP_400");
  assert.equal(rpcErrorFromResponse(404, "Could not find the function"), "HTTP_404");
  assert.equal(rpcErrorFromResponse(503, undefined), "HTTP_503");
});

// ---------------------------------------------------------------------------
// 请求体校验
// ---------------------------------------------------------------------------

const ids = (n: number) => Array.from({ length: n }, (_, i) => `33333333-3333-4333-8333-${String(i).padStart(12, "0")}`);

Deno.test("parseRequest：未知 action / 缺 admin_key / 非对象 → BAD_REQUEST", () => {
  throwsCode(() => parseRequest({ action: "rm", admin_key: "k" }), "BAD_REQUEST");
  throwsCode(() => parseRequest({ action: "view", kind: "thumb", photo_ids: [] }), "BAD_REQUEST");
  throwsCode(() => parseRequest(null), "BAD_REQUEST");
  throwsCode(() => parseRequest([]), "BAD_REQUEST");
});

Deno.test("parseRequest：photo_ids 最多 500，坏 uuid 拒绝", () => {
  assert.equal((parseRequest({ action: "download", admin_key: "k", photo_ids: ids(500) }) as { photo_ids: string[] }).photo_ids.length, 500);
  throwsCode(() => parseRequest({ action: "download", admin_key: "k", photo_ids: ids(501) }), "BAD_REQUEST");
  throwsCode(() => parseRequest({ action: "view", admin_key: "k", kind: "thumb", photo_ids: ids(501) }), "BAD_REQUEST");
  throwsCode(() => parseRequest({ action: "delete", admin_key: "k", photo_ids: ids(501) }), "BAD_REQUEST");
  throwsCode(() => parseRequest({ action: "download", admin_key: "k", photo_ids: ["not-a-uuid"] }), "BAD_REQUEST");
  throwsCode(() => parseRequest({ action: "download", admin_key: "k", photo_ids: "x" }), "BAD_REQUEST");
});

Deno.test("parseRequest：view 的 kind、delete 二选一、upload 字段类型", () => {
  throwsCode(() => parseRequest({ action: "view", admin_key: "k", kind: "full", photo_ids: [] }), "BAD_REQUEST");
  throwsCode(() => parseRequest({ action: "delete", admin_key: "k" }), "BAD_REQUEST");
  throwsCode(() => parseRequest({ action: "delete", admin_key: "k", album_id: ALBUM, photo_ids: [] }), "BAD_REQUEST");
  assert.deepEqual(parseRequest({ action: "delete", admin_key: "k", album_id: ALBUM }), { action: "delete", admin_key: "k", album_id: ALBUM });

  const up = { action: "upload", admin_key: "k", album_id: ALBUM, filename: "a.jpg", content_type: "image/jpeg", size_bytes: 10 };
  assert.deepEqual(parseRequest(up), { ...up, taken_at: null });
  assert.equal((parseRequest({ ...up, taken_at: "2026-09-20T10:00:00Z" }) as { taken_at: string }).taken_at, "2026-09-20T10:00:00Z");
  throwsCode(() => parseRequest({ ...up, size_bytes: "10" }), "BAD_REQUEST");
  throwsCode(() => parseRequest({ ...up, size_bytes: 1.5 }), "BAD_REQUEST");
  throwsCode(() => parseRequest({ ...up, taken_at: "昨天" }), "BAD_REQUEST");
  throwsCode(() => parseRequest({ ...up, album_id: "x" }), "BAD_REQUEST");
  throwsCode(() => parseRequest({ ...up, filename: "" }), "BAD_REQUEST");
  throwsCode(() => parseRequest({ action: "complete", admin_key: "k" }), "BAD_REQUEST");
});

// ---------------------------------------------------------------------------
// S3 XML
// ---------------------------------------------------------------------------

Deno.test("deleteObjectsXml：& < > 转义，Quiet 模式，超过 1000 个拒绝", () => {
  const xml = deleteObjectsXml([`${PREFIX}original/a&b<c>.jpg`, `${PREFIX}thumb.jpg`]);
  assert.ok(xml.includes("<Key>" + `${PREFIX}original/a&amp;b&lt;c&gt;.jpg` + "</Key>"));
  assert.ok(!xml.includes("a&b"));
  assert.ok(xml.includes("<Quiet>true</Quiet>"));
  assert.equal(xml.match(/<Object>/g)?.length, 2);
  throwsCode(() => deleteObjectsXml(new Array(1001).fill("k")), "STORAGE_ERROR");
  throwsCode(() => deleteObjectsXml([]), "STORAGE_ERROR");
});

Deno.test("md5Base64：base64 的原始摘要（Content-MD5 要求的格式）", () => {
  assert.equal(md5Base64(""), "1B2M2Y8AsgTpgAmY7PhCfg==");
  assert.equal(md5Base64("abc"), "kAFQmDzST7DWlj99KOF/cg==");
});

Deno.test("parseListObjects / parseDeleteErrors", () => {
  const list = `<ListBucketResult><IsTruncated>true</IsTruncated>
    <Contents><Key>${PREFIX}original/a&amp;b.jpg</Key><Size>1</Size></Contents>
    <Contents><Key>${PREFIX}thumb.jpg</Key></Contents>
    <NextContinuationToken>tok&amp;1</NextContinuationToken></ListBucketResult>`;
  assert.deepEqual(parseListObjects(list), { keys: [`${PREFIX}original/a&b.jpg`, `${PREFIX}thumb.jpg`], nextToken: "tok&1" });
  assert.deepEqual(parseListObjects("<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>"), { keys: [], nextToken: null });
  assert.deepEqual(parseDeleteErrors("<DeleteResult></DeleteResult>"), []);
  assert.deepEqual(parseDeleteErrors("<DeleteResult><Error><Key>a&lt;b</Key><Code>AccessDenied</Code></Error></DeleteResult>"), ["a<b"]);
  assert.equal(xmlUnescape("&#20013;&#x6587;&quot;"), '中文"');
});

// ---------------------------------------------------------------------------
// 配置 / CORS
// ---------------------------------------------------------------------------

const FULL_ENV: Record<string, string> = {
  SUPABASE_URL: "http://kong:8000",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_x",
  R2_ENDPOINT: "https://r2.test",
  R2_ACCESS_KEY_ID: "AKID",
  R2_SECRET_ACCESS_KEY: "SECRET",
  R2_BUCKET: "b",
  ALLOWED_ORIGINS: "http://localhost:5173, https://gcgc.example/",
};

Deno.test("readConfig：缺任何一项 → null；ALLOWED_ORIGINS 逗号分隔、去空格和结尾斜杠", () => {
  const cfg = readConfig((k) => FULL_ENV[k]);
  assert.deepEqual(cfg?.allowedOrigins, ["http://localhost:5173", "https://gcgc.example"]);
  assert.equal(cfg?.r2Region, "auto");
  assert.equal(cfg?.r2PublicEndpoint, "https://r2.test");
  for (const k of Object.keys(FULL_ENV)) {
    assert.equal(readConfig((n) => (n === k ? undefined : FULL_ENV[n])), null, k);
  }
  assert.equal(readConfig((n) => (n === "ALLOWED_ORIGINS" ? " , " : FULL_ENV[n])), null);
});

Deno.test("corsHeaders：只回显白名单 origin，总是 Vary: Origin", () => {
  const ok = corsHeaders("http://localhost:5173", ["http://localhost:5173"]);
  assert.equal(ok.get("access-control-allow-origin"), "http://localhost:5173");
  assert.equal(ok.get("access-control-allow-headers"), "apikey, authorization, content-type, x-client-info");
  assert.equal(ok.get("access-control-allow-methods"), "POST, OPTIONS");
  assert.equal(ok.get("vary"), "Origin");
  const no = corsHeaders("https://evil.example", ["http://localhost:5173"]);
  assert.equal(no.get("access-control-allow-origin"), null);
  assert.equal(no.get("vary"), "Origin");
  assert.equal(corsHeaders(null, ["http://localhost:5173"]).get("access-control-allow-origin"), null);
});
