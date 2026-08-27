import type { BoardPlayer, BoardSnapshot, FeedItem } from "../lib/types";

const NAMES = [
  "林沐恩", "陈子谦", "黄恩慈", "张乐言", "王心怡", "李俊熙", "周以诺", "吴佳音",
  "何嘉树", "郑思源", "梁安琪", "许天佑", "郭美琳", "苏以琳", "罗嘉诚", "冯悦宁",
  "徐恩典", "马梓轩", "朱晓彤", "胡天乐", "高雅雯", "谢宇航", "宋可欣", "唐子墨",
  "邓诗晴", "曹书恩", "叶铭轩", "潘欣妍", "杜嘉禾", "彭以安", "蔡乐怡", "袁浩然",
  "魏心悦", "沈天恩", "卢思齐", "余安然", "钟嘉懿", "范子涵", "田牧言", "陆恩泽",
  "戴可恩", "江语彤", "姚俊杰", "金思恩", "夏天佑", "方乐晴", "石嘉言", "廖恩熙",
  "谭梓晴", "莫以诺",
];

const players: BoardPlayer[] = NAMES.map((name, index) => ({
  id: `preview-player-${index + 1}`,
  name,
  identity: index % 7 === 0 ? "solo" : index % 3 === 0 ? "trio" : "duo",
  color_group: index % 7 === 0 ? `solo-${(index % 8) + 1}` : ["red", "blue", "green", "violet", "orange"][index % 5],
  team_id: index % 7 === 0 ? `team-s-${index}` : index % 3 === 0 ? `team-t-${Math.floor(index / 3)}` : `team-d-${Math.floor(index / 2)}`,
  member_count: index % 7 === 0 ? 1 : index % 3 === 0 ? 3 : 2,
  score: Math.max(3, 58 - index - Math.floor(index / 4)),
  locked: index === 6 || index === 21,
  token_available: index % 6 !== 0,
  sick: index === 13,
  stations_done: Math.max(1, 7 - Math.floor(index / 9)),
  life_events_done: Math.min(3, Math.floor(Math.max(1, 7 - Math.floor(index / 9)) / 2)),
}));

/** Minutes ago, so the feed clock agrees with the elapsed timer above it. */
const ago = (minutes: number) => new Date(Date.now() - minutes * 60 * 1000).toISOString();

const feed: FeedItem[] = [
  { id: "f1", kind: "attempt", name: "林沐恩 / 周以诺", color_group: "red", identity: "duo", station: "创意工坊", status: "passed", score: 9, total: 58, at: ago(1) },
  { id: "f2", kind: "life_event", name: "黄恩慈", card: "choice_all_wallet", label: "失主留下一句谢谢", scene: "捡到钱包", choice: "先交给失物处", outcome: "失主留下一句谢谢", stage: 2, before: 45, after: 48, at: ago(2) },
  { id: "f3", kind: "token", name: "张乐言", usage: "second_chance", station: "默契挑战", at: ago(4) },
  { id: "f4", kind: "attempt", name: "王心怡 / 李俊熙 / 何嘉树", color_group: "violet", identity: "trio", station: "人生选择", status: "passed", score: 6, total: 51, at: ago(6) },
  { id: "f5", kind: "attempt", name: "吴佳音", color_group: "solo-2", identity: "solo", station: "体能补给", status: "failed", score: 0, total: 43, at: ago(9) },
];

/* Relative to now, so the demo board shows a believable "已进行 22:00" instead
   of the hours-since-a-hardcoded-date the fixed timestamp produced. */
const STARTED_AT = new Date(Date.now() - 22 * 60 * 1000).toISOString();

export const SCREEN_PREVIEW: BoardSnapshot = {
  phase: "playing",
  started_at: STARTED_AT,
  stations_total: 7,
  players,
  stats: { players: players.length, teams: 27, stamps: 237, life_events: 18, tokens_used: 11, top_score: players[0].score },
  awards: null,
  feed,
};

/** Ceremony preview: /screen?preview=awards */
export const SCREEN_AWARDS: BoardSnapshot["awards"] = {
  podium: [
    { rank: 1, name: "林沐恩", score: 58, color_group: "red", identity: "duo", stations_done: 7, life_events: 3 },
    { rank: 2, name: "陈子谦", score: 55, color_group: "blue", identity: "trio", stations_done: 7, life_events: 3 },
    { rank: 3, name: "黄恩慈", score: 51, color_group: "blue", identity: "trio", stations_done: 7, life_events: 3 },
  ],
  specials: [
    { key: "lucky", emoji: "🍀", title: "天选之子", subtitle: "人生事件加分最多", caption: "人生事件净赚 +14 分", name: "张乐言", color_group: "green", identity: "duo", score: 47 },
    { key: "unlucky", emoji: "🌧️", title: "时运不济", subtitle: "人生事件扣分最多", caption: "人生事件净亏 12 分", name: "王心怡", color_group: "violet", identity: "trio", score: 26 },
    { key: "rollercoaster", emoji: "🎢", title: "人生过山车", subtitle: "同时经历了最高的加分和最重的扣分", caption: "一次 +21，一次 -9，落差 30 分", name: "吴佳音", color_group: "solo-2", identity: "solo", score: 33 },
    { key: "steady_heart", emoji: "🌊", title: "波澜不惊", subtitle: "经历过人生，却最稳得住", caption: "三段人生上下不超过 3 分", name: "何嘉树", color_group: "cyan", identity: "trio", score: 44 },
  ],
  /* Exactly one team award: the station run is the only thing a team does
     together, and the two retired station-score awards always went to the
     same team as each other. */
  team_awards: [
    { key: "fastest", emoji: "⚡", title: "最快通关", subtitle: "全场最先走完所有站点", caption: "全场第一个完成 7 站", members: "林沐恩 / 周以诺", member_count: 2, color_group: "red", identity: "duo" },
  ],
};
