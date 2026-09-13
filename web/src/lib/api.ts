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

/* There is no `readView` any more. `stations` was the one table anon could read
   directly, and phase 2 took that away: the library now holds every org's own
   station names, and which stations an event runs is per-event state. Every
   read goes through an RPC that scopes itself to one key (`staff_stations`,
   `admin_event_stations`, `board_snapshot`). */

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
  BAD_GAME_LINK: "这个入场链接无效，请扫描现场最新二维码",
  GAME_ARCHIVED: "这一场活动已经归档",
  JOIN_CLOSED: "本场登记已关闭，请联系现场工作人员",
  BAD_GAME_TITLE: "活动名称要 1~60 个字",
  ACTIVE_GAME_EXISTS: "当前场次仍有玩家，确认归档后才能创建新场次",
  EVENT_NOT_FOUND: "找不到这场活动，它可能已被移除",
  BAD_NEW_KEY: "密码长度不符合要求：工作人员至少 6 位，管理员至少 8 位",
  GAME_IN_PROGRESS: "游戏进行中不能修改站点配置",
  EVENT_IN_PROGRESS: "活动已经开场，本场站点名单不能再整份改了；临时缺人手请用「撤站」",
  EVENT_ENDED: "这场活动已经结束，站点名单只能看不能改",
  LIFE_EVENT_REQUIRED: "每场必须保留人生盲盒站，它是玩家手机上的事件入口",
  MAIN_STATION_REQUIRED: "至少要留一个主线站点",
  STATION_IN_USE: "这个站点被某场活动用过，不能删，只能改名",
  FORBIDDEN: "内置站点不能直接改，请先「复制为自己的」再改副本",
  BAD_STATION_NAME: "站点名称要 1~30 个字",
  BAD_STATION_TYPE: "站点类型不合法",
  BAD_SCORING_MODE: "计分方式不合法",
  BAD_NAME: "名字要 1~20 个字",
  BAD_CONTACT: "联系方式最多 80 个字",
  PLAYER_NAME_MISMATCH: "姓名与这个人生编号不一致，请重新核对",
  GAME_ENDED: "游戏已经结束啦",
  GAME_NOT_PLAYING: "游戏还没开始（或已结束），暂时不能操作",
  PLAYER_NOT_FOUND: "找不到玩家 {d}，请核对人生编号",
  ALREADY_ATTEMPTED: "{d} 已经挑战过本站了",
  TEAM_NOT_FOUND: "找不到 {d} 这本护照，请核对人生编号",
  TEAM_ALREADY_ATTEMPTED: "队伍 {d} 已经挑战过本站",
  BAD_TEAM_SCORE: "这次整队分数不符合本站计分规则",
  TEAM_NOT_ATTEMPTED: "这支队伍还没有挑战过该站",
  LOCKED_LIFE_EVENT: "{d} 需要先去人生盲盒站处理突发事件",
  NOT_LOCKED: "{d} 当前没有被锁定，不需要抽卡",
  BAD_SCORE: "{d} 的分数不合法",
  BAD_STATION: "站点不对",
  DUPLICATE_CODES: "同一批里有重复的人生编号",
  NO_TOKEN: "{d} 的 Help Token 已经用过了",
  NOT_FAILED_STATION: "Second Chance 只能用在挑战失败过的站",
  RETRY_ALREADY_GRANTED: "这一站已经有一次待使用的重试机会了",
  TEAM_TOKEN_INCOMPLETE: "队伍 {d} 中已有成员使用过 Token，无法再启用整队帮助",
  TEAM_NOT_FAILED: "这支队伍还没有挑战过该站",
  CARD_REDEMPTION_NOT_OPEN: "纪念卡兑换会在活动结束后开放",
  EVENT_NOT_PENDING: "这个人生事件已经处理过了",
  BAD_EVENT_CHOICE: "这个选择无效，请刷新后再试",
  NO_EVENT_SCENE: "暂时没有可用的人生事件，请联系工作人员",
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
