// Minimal PostgREST client. Deliberately NOT supabase-js: a 40-line fetch
// wrapper is one less dependency, and we fully control timeouts and retries
// (the venue network drops connections; every write is idempotent server-side).

const BASE = import.meta.env.VITE_SUPABASE_URL as string;
const API_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  import.meta.env.VITE_SUPABASE_ANON_KEY) as string;

export class RpcError extends Error {
  code: string; // e.g. 'LOCKED_LIFE_EVENT'
  detail: string; // e.g. '1234' (the code suffix), '' if none

  constructor(raw: string) {
    super(raw);
    const idx = raw.indexOf(":");
    this.code = idx === -1 ? raw : raw.slice(0, idx);
    this.detail = idx === -1 ? "" : raw.slice(idx + 1);
  }
}

const TIMEOUT_MS = 10_000;

async function post(path: string, body: unknown): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: {
        apikey: API_KEY,
        authorization: `Bearer ${API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Call a Postgres RPC. Retries network failures / 5xx with exponential
 * backoff (x2, as per spec) — safe because writes carry idempotency keys.
 * Logic errors (Postgres RAISE -> 400) are thrown as RpcError immediately.
 */
export async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const delays = [800, 1600]; // 2 retries
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await post(`/rest/v1/rpc/${fn}`, args);
      if (res.ok) {
        const data = (await res.json()) as T & { _error?: string; _detail?: string };
        if (data && typeof data === "object" && data._error) {
          throw new RpcError(`${data._error}${data._detail ? `:${data._detail}` : ""}`);
        }
        return data;
      }
      if (res.status >= 500 && attempt < delays.length) {
        await sleep(delays[attempt]);
        continue;
      }
      let message = `HTTP_${res.status}`;
      try {
        const body = (await res.json()) as { message?: string };
        if (body.message) message = body.message;
      } catch {
        // non-JSON error body; keep HTTP_ code
      }
      throw new RpcError(message);
    } catch (err) {
      if (err instanceof RpcError) throw err;
      // network failure / timeout
      if (attempt < delays.length) {
        await sleep(delays[attempt]);
        continue;
      }
      throw new RpcError("NETWORK");
    }
  }
}

/** Read a deliberately exposed public table or view (currently stations). */
export async function readView<T>(query: string): Promise<T> {
  const res = await fetch(`${BASE}/rest/v1/${query}`, {
    headers: { apikey: API_KEY, authorization: `Bearer ${API_KEY}` },
  });
  if (!res.ok) throw new RpcError(`HTTP_${res.status}`);
  return (await res.json()) as T;
}

export function newIdemKey(): string {
  // crypto.randomUUID needs a secure context; WeChat webviews on plain http
  // during local testing may lack it, so keep a fallback.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Machine error codes -> user-facing Chinese (mirrors LOGIC.md). */
const ERROR_ZH: Record<string, string> = {
  BAD_PASSPHRASE: "口令不对，请确认主持人公布的入场口令",
  BAD_NAME: "名字要 1~20 个字",
  GAME_ENDED: "游戏已经结束啦",
  GAME_NOT_PLAYING: "游戏还没开始（或已结束），暂时不能操作",
  PLAYER_NOT_FOUND: "找不到玩家 {d}，请核对 4 位码",
  ALREADY_ATTEMPTED: "{d} 已经挑战过本站了",
  LOCKED_LIFE_EVENT: "{d} 需要先去人生盲盒站处理突发事件",
  NOT_LOCKED: "{d} 当前没有被锁定，不需要抽卡",
  BAD_SCORE: "{d} 的分数不合法",
  BAD_STATION: "站点不对",
  DUPLICATE_CODES: "同一批里有重复的 4 位码",
  NO_TOKEN: "{d} 的 Help Token 已经用过了",
  NOT_FAILED_STATION: "Second Chance 只能用在挑战失败过的站",
  RETRY_ALREADY_GRANTED: "这一站已经有一次待使用的重试机会了",
  STATION_REQUIRED: "请先选择要重试的站点",
  ALREADY_STARTED: "游戏已经开始过了",
  NO_PLAYERS: "还没有玩家加入，无法开始",
  BAD_KEY: "密码不对",
  RATE_LIMITED: "尝试太频繁，请稍等几秒再试",
  MISSING_IDEMPOTENCY_KEY: "系统错误：缺少幂等标识",
  NETWORK: "网络不太顺，稍等一下再试",
};

export function errorText(err: unknown): string {
  if (err instanceof RpcError) {
    const tpl = ERROR_ZH[err.code];
    if (tpl) return tpl.replace("{d}", err.detail || "该玩家");
    return `出错了（${err.code}）`;
  }
  return "出错了，请再试一次";
}
