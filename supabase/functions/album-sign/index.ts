/*
 * album-sign：给「机构活动相册」签发 R2 预签名 URL，并代浏览器做 HEAD / 删除。
 * R2 密钥只在这里（Edge Function secrets），浏览器只拿到限时、限定单个对象的 URL。
 * 逻辑在 handler.ts / lib.ts；这里只把真实的 fetch 和环境变量接上。
 */

import { makeHandler } from "./handler.ts";

Deno.serve(makeHandler({ fetch: (input, init) => fetch(input, init), env: (k) => Deno.env.get(k) }));
