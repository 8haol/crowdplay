/*
 * 爱心按设备算：没有账号体系，就用一个存在 localStorage 里的随机 UUID 当「这台设备」。
 *
 * localStorage 可能整个不可用（隐私模式、被禁用的存储），读写都包 try/catch；
 * 不可用时退回只活在内存里的 id，刷新后会被当成新设备，这点可以接受。
 *
 * 不直接用 newIdemKey()：它在没有 crypto.randomUUID 的环境里退回的是
 * 「时间戳-随机串」，不是 UUID，而 RPC 的 p_device_id 是 uuid 类型，会直接报错。
 */
const STORAGE_KEY = "album.device_id";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let current: string | null = null;

export function uuidV4(): string {
  // randomUUID 只在安全上下文里有（本地用 http 打开时没有），getRandomValues 到处都有。
  const source: Partial<Crypto> | undefined = typeof crypto === "undefined" ? undefined : crypto;
  if (typeof source?.randomUUID === "function") return source.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof source?.getRandomValues === "function") source.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function deviceId(): string {
  if (current) return current;
  let id: string | null = null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && UUID_RE.test(stored)) id = stored;
  } catch {
    // 读不到就当第一次来
  }
  if (!id) {
    id = uuidV4();
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // 写不进去：这个 id 只在本次打开页面期间有效
    }
  }
  current = id;
  return id;
}
