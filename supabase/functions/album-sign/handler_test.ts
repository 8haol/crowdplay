// 用注入的假 fetch 跑整个 handler：RPC 和 R2 都是假的，只看函数发了什么、回了什么。
import assert from "node:assert/strict";
import { makeHandler } from "./handler.ts";
import { encodeKey, md5Base64 } from "./lib.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const ALBUM = "22222222-2222-4222-8222-222222222222";
const PHOTO = "33333333-3333-4333-8333-333333333333";
const STALE = "44444444-4444-4444-8444-444444444444";
const PREFIX = `orgs/${ORG}/albums/${ALBUM}/${PHOTO}/`;
const STALE_PREFIX = `orgs/${ORG}/albums/${ALBUM}/${STALE}/`;
const ORIGIN = "http://localhost:5173";

const ENV: Record<string, string> = {
  SUPABASE_URL: "http://kong:8000",
  SUPABASE_SERVICE_ROLE_KEY: "eyJservice",
  R2_ENDPOINT: "http://host.docker.internal:9000",
  R2_PUBLIC_ENDPOINT: "http://localhost:9000",
  R2_ACCESS_KEY_ID: "AKID",
  R2_SECRET_ACCESS_KEY: "SECRET",
  R2_BUCKET: "albums",
  ALLOWED_ORIGINS: ORIGIN,
};

interface Seen {
  method: string;
  url: URL;
  headers: Headers;
  body: string;
}

type Rpc = (fn: string, args: Record<string, unknown>) => Response | unknown;
type S3 = (req: Seen) => Response | undefined;

/** RPC 返回普通对象就当 200 JSON；返回 Response 原样用。R2 默认：HEAD 404，其余 200 空。 */
function setup(rpc: Rpc, s3: S3 = () => undefined, env = ENV) {
  const seen: Seen[] = [];
  const rpcCalls: { fn: string; args: Record<string, unknown>; headers: Headers }[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    const s: Seen = { method: req.method, url: new URL(req.url), headers: req.headers, body: await req.text() };
    if (s.url.pathname.startsWith("/rest/v1/rpc/")) {
      const fn = s.url.pathname.slice("/rest/v1/rpc/".length);
      const args = JSON.parse(s.body);
      rpcCalls.push({ fn, args, headers: s.headers });
      const out = rpc(fn, args);
      return out instanceof Response ? out : Response.json(out);
    }
    seen.push(s);
    return s3(s) ?? new Response(s.method === "HEAD" ? null : "", { status: s.method === "HEAD" ? 404 : 200 });
  };
  const handler = makeHandler({ fetch: fakeFetch, env: (k) => env[k], datetime: () => "20260925T010203Z" });
  const call = async (body: unknown, method = "POST") => {
    const res = await handler(
      new Request("http://fn.test/album-sign", {
        method,
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: method === "POST" ? JSON.stringify(body) : undefined,
      }),
    );
    return { res, json: res.status === 204 ? null : await res.json() };
  };
  return { call, handler, seen, rpcCalls };
}

const pgError = (message: string) => Response.json({ code: "P0001", message }, { status: 400 });

const obj = (over: Record<string, unknown> = {}) => ({
  photo_id: PHOTO,
  status: "pending",
  prefix: PREFIX,
  original_key: `${PREFIX}original/a.jpg`,
  filename: "a.jpg",
  content_type: "image/jpeg",
  has_thumb: false,
  has_preview: false,
  ...over,
});

// ---------------------------------------------------------------------------

Deno.test("upload：签名路径只来自 RPC 的 original_key，客户端 filename 里的 ../ 不影响", async () => {
  const evil = "../../etc/passwd 园#?.jpg";
  // RPC 安全化后的文件名：/ → _，去掉开头的点
  const originalKey = `${PREFIX}original/_.._etc_passwd 园#?.jpg`;
  const { call, rpcCalls, seen } = setup((fn) => {
    assert.equal(fn, "album_reserve_upload");
    return { photo_id: PHOTO, prefix: PREFIX, original_key: originalKey, stale_prefixes: [] };
  });
  const { res, json } = await call({
    action: "upload",
    admin_key: "k",
    album_id: ALBUM,
    filename: evil,
    content_type: "image/heic",
    size_bytes: 123,
    taken_at: null,
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), ORIGIN);

  // RPC 收到的是客户端原样的文件名（安全化是 RPC 的事）
  assert.equal(rpcCalls[0].args.p_filename, evil);
  assert.equal(rpcCalls[0].args.p_size_bytes, 123);
  // 旧式 service_role key（ey 开头）两个头都要带
  assert.equal(rpcCalls[0].headers.get("apikey"), "eyJservice");
  assert.equal(rpcCalls[0].headers.get("authorization"), "Bearer eyJservice");

  const orig = new URL(json.put_original);
  assert.equal(orig.origin, "http://localhost:9000", "给浏览器的 URL 用 R2_PUBLIC_ENDPOINT");
  assert.equal(orig.pathname, `/albums/${encodeKey(originalKey)}`);
  assert.ok(!orig.pathname.includes("/../") && !orig.pathname.includes("/etc/"));
  assert.equal(orig.searchParams.get("X-Amz-SignedHeaders"), "content-type;host");
  assert.equal(orig.searchParams.get("X-Amz-Expires"), "900");

  assert.equal(new URL(json.put_thumb).pathname, `/albums/${PREFIX}thumb.jpg`);
  assert.equal(new URL(json.put_preview).pathname, `/albums/${PREFIX}preview.jpg`);
  assert.equal(new URL(json.put_thumb).searchParams.get("X-Amz-SignedHeaders"), "content-type;host");
  assert.equal(json.photo_id, PHOTO);
  assert.equal(seen.length, 0, "没有 stale 前缀就不碰存储");
});

Deno.test("upload：原片按请求的 content_type 签，小图按 image/jpeg 签", async () => {
  const { call } = setup(() => ({ photo_id: PHOTO, prefix: PREFIX, original_key: `${PREFIX}original/a.mov`, stale_prefixes: [] }));
  const body = { action: "upload", admin_key: "k", album_id: ALBUM, filename: "a.mov", size_bytes: 9 };
  const sig = async (ct: string) => {
    const { json } = await call({ ...body, content_type: ct });
    return { orig: new URL(json.put_original).searchParams.get("X-Amz-Signature"), thumb: new URL(json.put_thumb).searchParams.get("X-Amz-Signature") };
  };
  const a = await sig("video/quicktime");
  const b = await sig("video/mp4");
  assert.notEqual(a.orig, b.orig, "原片签名随 content_type 变");
  assert.equal(a.thumb, b.thumb, "缩略图固定签 image/jpeg");
});

Deno.test("upload：stale 前缀先列出再 DeleteObjects（带 Content-MD5），只删该前缀下的", async () => {
  const { call, seen } = setup(
    () => ({ photo_id: PHOTO, prefix: PREFIX, original_key: `${PREFIX}original/a.jpg`, stale_prefixes: [STALE_PREFIX] }),
    (s) => {
      if (s.method === "GET" && s.url.searchParams.get("list-type") === "2") {
        return new Response(
          `<ListBucketResult><IsTruncated>false</IsTruncated>` +
            `<Contents><Key>${STALE_PREFIX}original/x&amp;y.jpg</Key></Contents>` +
            `<Contents><Key>${STALE_PREFIX}thumb.jpg</Key></Contents></ListBucketResult>`,
        );
      }
    },
  );
  const { res } = await call({ action: "upload", admin_key: "k", album_id: ALBUM, filename: "a.jpg", content_type: "image/jpeg", size_bytes: 1 });
  assert.equal(res.status, 200);
  const [list, del] = seen;
  // 函数自己发的请求走内网地址 R2_ENDPOINT
  assert.equal(list.url.origin, "http://host.docker.internal:9000");
  assert.equal(list.url.pathname, "/albums");
  assert.equal(list.url.searchParams.get("prefix"), STALE_PREFIX);
  assert.match(list.headers.get("authorization") ?? "", /^AWS4-HMAC-SHA256 /);
  assert.equal(del.method, "POST");
  assert.ok(del.url.searchParams.has("delete"));
  assert.equal(del.headers.get("content-md5"), md5Base64(del.body));
  assert.ok(del.body.includes(`<Key>${STALE_PREFIX}original/x&amp;y.jpg</Key>`));
  assert.ok(del.body.includes(`<Key>${STALE_PREFIX}thumb.jpg</Key>`));
});

Deno.test("BAD_KEY → 401", async () => {
  const { call } = setup(() => pgError("BAD_KEY"));
  const { res, json } = await call({ action: "view", admin_key: "wrong", kind: "thumb", photo_ids: [PHOTO] });
  assert.equal(res.status, 401);
  assert.deepEqual(json, { error: "BAD_KEY" });
});

Deno.test("RATE_LIMITED → 429", async () => {
  const { call } = setup(() => pgError("RATE_LIMITED"));
  const { res } = await call({ action: "complete", admin_key: "wrong", photo_id: PHOTO });
  assert.equal(res.status, 429);
});

Deno.test("Postgres 自带的英文报错不外泄，换成 HTTP_400", async () => {
  const { call } = setup(() => pgError("permission denied for function album_objects_for"));
  const { res, json } = await call({ action: "download", admin_key: "k", photo_ids: [PHOTO] });
  assert.equal(res.status, 400);
  assert.deepEqual(json, { error: "HTTP_400" });
});

Deno.test("未知 action / 坏 JSON → 400 BAD_REQUEST；GET → 405", async () => {
  const { call, handler, rpcCalls } = setup(() => ({}));
  assert.deepEqual((await call({ action: "nuke", admin_key: "k" })).json, { error: "BAD_REQUEST" });
  const raw = await handler(new Request("http://fn.test/", { method: "POST", body: "{", headers: { origin: ORIGIN } }));
  assert.equal(raw.status, 400);
  assert.deepEqual(await raw.json(), { error: "BAD_REQUEST" });
  assert.equal((await call(null, "GET")).res.status, 405);
  assert.equal(rpcCalls.length, 0);
});

Deno.test("缺配置 → 500 NOT_CONFIGURED", async () => {
  const { call } = setup(() => ({}), undefined, { ...ENV, R2_BUCKET: "" });
  const { res, json } = await call({ action: "view", admin_key: "k", kind: "thumb", photo_ids: [] });
  assert.equal(res.status, 500);
  assert.deepEqual(json, { error: "NOT_CONFIGURED" });
});

Deno.test("CORS 预检：白名单 origin 回显，其他不回", async () => {
  const { handler } = setup(() => ({}));
  const pre = (origin: string) =>
    handler(new Request("http://fn.test/", { method: "OPTIONS", headers: { origin, "access-control-request-method": "POST" } }));
  const ok = await pre(ORIGIN);
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(ok.headers.get("vary"), "Origin");
  const no = await pre("https://evil.example");
  assert.equal(no.headers.get("access-control-allow-origin"), null);
});

Deno.test("complete：原片 HEAD 404 按 0 字节报给 RPC；ALBUM_SIZE_MISMATCH 时先删对象再删行", async () => {
  const { call, rpcCalls, seen } = setup((fn) => {
    if (fn === "album_objects_for") return { objects: [obj()] };
    if (fn === "album_complete_upload") return pgError("ALBUM_SIZE_MISMATCH");
    if (fn === "album_delete_photos") return { deleted: 1 };
  }, (s) => {
    if (s.method === "HEAD" && s.url.pathname.endsWith("/thumb.jpg")) {
      return new Response(null, { status: 200, headers: { "content-length": "5" } });
    }
  });
  const { res, json } = await call({ action: "complete", admin_key: "k", photo_id: PHOTO });
  assert.equal(res.status, 400);
  assert.deepEqual(json, { error: "ALBUM_SIZE_MISMATCH" });
  const done = rpcCalls.find((c) => c.fn === "album_complete_upload")!;
  assert.equal(done.args.p_actual_size, 0);
  assert.equal(done.args.p_has_thumb, true);
  assert.equal(done.args.p_has_preview, false);
  const del = seen.find((s) => s.method === "POST")!;
  for (const k of [`${PREFIX}original/a.jpg`, `${PREFIX}thumb.jpg`, `${PREFIX}preview.jpg`]) {
    assert.ok(del.body.includes(`<Key>${k}</Key>`), k);
  }
  // RPC 抛异常会回滚，行还是 pending，得由函数删掉
  assert.deepEqual(rpcCalls.map((c) => c.fn), ["album_objects_for", "album_complete_upload", "album_delete_photos"]);
  assert.deepEqual(rpcCalls[2].args, { p_admin_key: "k", p_photo_ids: [PHOTO] });
});

Deno.test("complete：ALBUM_SIZE_MISMATCH 后删对象失败 → 不删行（留给 abort / stale 清理），仍回 400", async () => {
  const { call, rpcCalls } = setup((fn) => {
    if (fn === "album_objects_for") return { objects: [obj()] };
    if (fn === "album_complete_upload") return pgError("ALBUM_SIZE_MISMATCH");
  }, (s) => (s.method === "POST" ? new Response("boom", { status: 500 }) : undefined));
  const { res, json } = await call({ action: "complete", admin_key: "k", photo_id: PHOTO });
  assert.equal(res.status, 400);
  assert.deepEqual(json, { error: "ALBUM_SIZE_MISMATCH" });
  assert.ok(!rpcCalls.some((c) => c.fn === "album_delete_photos"));
});

Deno.test("complete：大小对上 → 200，返回 has_*", async () => {
  const { call, rpcCalls } = setup((fn) => {
    if (fn === "album_objects_for") return { objects: [obj()] };
    return { photo_id: PHOTO, status: "ready" };
  }, (s) => {
    if (s.method === "HEAD" && s.url.pathname.includes("/original/")) {
      return new Response(null, { status: 200, headers: { "content-length": "4999999999" } });
    }
    if (s.method === "HEAD" && s.url.pathname.endsWith("/preview.jpg")) return new Response(null, { status: 200 });
  });
  const { res, json } = await call({ action: "complete", admin_key: "k", photo_id: PHOTO });
  assert.equal(res.status, 200);
  assert.deepEqual(json, { photo_id: PHOTO, has_thumb: false, has_preview: true });
  assert.equal(rpcCalls.find((c) => c.fn === "album_complete_upload")!.args.p_actual_size, 4999999999);
});

Deno.test("abort：ready 的不删；pending 的先删对象再删行；存储失败 → 502 且不删行", async () => {
  {
    const { call, rpcCalls, seen } = setup(() => ({ objects: [obj({ status: "ready" })] }));
    assert.deepEqual((await call({ action: "abort", admin_key: "k", photo_id: PHOTO })).json, { ok: true });
    assert.equal(seen.length, 0);
    assert.deepEqual(rpcCalls.map((c) => c.fn), ["album_objects_for"]);
  }
  {
    const { call, rpcCalls, seen } = setup((fn) => (fn === "album_objects_for" ? { objects: [obj()] } : { deleted: 1 }));
    assert.deepEqual((await call({ action: "abort", admin_key: "k", photo_id: PHOTO })).json, { ok: true });
    assert.equal(seen.length, 1);
    assert.deepEqual(rpcCalls.map((c) => c.fn), ["album_objects_for", "album_delete_photos"]);
  }
  {
    const { call, rpcCalls } = setup(() => ({ objects: [obj()] }), () => new Response("boom", { status: 500 }));
    const { res, json } = await call({ action: "abort", admin_key: "k", photo_id: PHOTO });
    assert.equal(res.status, 502);
    assert.deepEqual(json, { error: "STORAGE_ERROR" });
    assert.ok(!rpcCalls.some((c) => c.fn === "album_delete_photos"));
  }
});

Deno.test("view：thumb 只给 has_thumb 的，pending 不给；download 带 attachment", async () => {
  const other = "55555555-5555-4555-8555-555555555555";
  const otherPrefix = `orgs/${ORG}/albums/${ALBUM}/${other}/`;
  const objects = [
    obj({ status: "ready", has_thumb: true, filename: "园游会.jpg" }),
    obj({ photo_id: other, prefix: otherPrefix, original_key: `${otherPrefix}original/b.jpg`, status: "ready" }),
  ];
  const { call } = setup(() => ({ objects }));
  const thumbs = (await call({ action: "view", admin_key: "k", kind: "thumb", photo_ids: [PHOTO, other] })).json;
  assert.deepEqual(Object.keys(thumbs.urls), [PHOTO]);
  assert.equal(new URL(thumbs.urls[PHOTO]).searchParams.get("X-Amz-Expires"), "3600");

  const orig = (await call({ action: "view", admin_key: "k", kind: "original", photo_ids: [PHOTO] })).json;
  assert.equal(new URL(orig.urls[PHOTO]).searchParams.get("response-content-disposition"), null);

  const dl = (await call({ action: "download", admin_key: "k", photo_ids: [PHOTO, other] })).json;
  assert.equal(dl.urls[PHOTO].filename, "园游会.jpg");
  assert.equal(
    new URL(dl.urls[PHOTO].url).searchParams.get("response-content-disposition"),
    `attachment; filename*=UTF-8''${encodeURIComponent("园游会.jpg")}`,
  );

  const { call: callPending } = setup(() => ({ objects: [obj({ has_thumb: true })] }));
  assert.deepEqual((await callPending({ action: "view", admin_key: "k", kind: "thumb", photo_ids: [PHOTO] })).json, { urls: {} });
});

Deno.test("delete album_id：分批取 id → 删对象 → 删行，直到空，再 album_delete", async () => {
  let round = 0;
  const { call, rpcCalls, seen } = setup((fn, args) => {
    if (fn === "album_photo_ids") {
      assert.equal(args.p_limit, 500);
      return { photo_ids: round++ === 0 ? [PHOTO] : [] };
    }
    if (fn === "album_objects_for") return { objects: [obj({ status: "ready" })] };
    if (fn === "album_delete_photos") return { deleted: 1 };
    if (fn === "album_delete") return { deleted: ALBUM };
  });
  const { res, json } = await call({ action: "delete", admin_key: "k", album_id: ALBUM });
  assert.equal(res.status, 200);
  assert.deepEqual(json, { deleted: 1 });
  assert.deepEqual(rpcCalls.map((c) => c.fn), [
    "album_photo_ids",
    "album_objects_for",
    "album_delete_photos",
    "album_photo_ids",
    "album_delete",
  ]);
  assert.equal(seen.filter((s) => s.method === "POST").length, 1);
});

Deno.test("delete photo_ids：只删 objects_for 认下的（别家的 id 被 RPC 静默丢掉）", async () => {
  const { call, rpcCalls } = setup((fn) => {
    if (fn === "album_objects_for") return { objects: [obj({ status: "ready" })] };
    if (fn === "album_delete_photos") return { deleted: 1 };
  });
  const foreign = "66666666-6666-4666-8666-666666666666";
  const { json } = await call({ action: "delete", admin_key: "k", photo_ids: [PHOTO, foreign] });
  assert.deepEqual(json, { deleted: 1 });
  assert.deepEqual(rpcCalls.find((c) => c.fn === "album_delete_photos")!.args.p_photo_ids, [PHOTO]);
});
