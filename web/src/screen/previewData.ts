import type { BoardPlayer, BoardSnapshot, BoardStation, FeedItem, SecretFeedFlag } from "../lib/types";
import { PREVIEW_STATIONS } from "../play/previewData";

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

/*
 * 大屏的 feed 要能改名：主题层按主摊位顺序把「音乐之声」换成「月下音乐会」，
 * 靠的是 station_id 在这张顺序表里的位置（`boothOf` 里的 findIndex）。
 * 少了 stations，演示大屏就只会念原名，中秋主题的摊位别名一次都不会出现。
 * 结构照抄 board_snapshot 的 'stations'：只有启用中的主摊位，按 sort_order 排。
 */
const stations: BoardStation[] = PREVIEW_STATIONS
  .filter((station) => station.type === "main")
  .map(({ station_id, name_zh, sort_order }) => ({ station_id: station_id!, name_zh, sort_order }));

const feed: (FeedItem & SecretFeedFlag)[] = [
  { id: "f0", kind: "attempt", name: "张乐言 / 赵恩慈", color_group: "green", identity: "duo", station_id: null, station: "神秘摊位", status: "passed", score: 6, total: 61, at: ago(0), secret: true },
  { id: "f1", kind: "attempt", name: "林沐恩 / 周以诺", color_group: "red", identity: "duo", station_id: 2, station: "音乐之声", status: "passed", score: 9, total: 58, at: ago(1) },
  { id: "f2", kind: "life_event", name: "黄恩慈", card: "choice_all_wallet", label: "失主留下一句谢谢", scene: "捡到钱包", choice: "先交给失物处", outcome: "失主留下一句谢谢", stage: 2, before: 45, after: 48, at: ago(2) },
  { id: "f3", kind: "token", name: "张乐言", usage: "second_chance", station_id: 4, station: "同心协力", at: ago(4) },
  { id: "f4", kind: "attempt", name: "王心怡 / 李俊熙 / 何嘉树", color_group: "violet", identity: "trio", station_id: 7, station: "旅途抉择", status: "passed", score: 6, total: 51, at: ago(6) },
  { id: "f5", kind: "attempt", name: "吴佳音", color_group: "solo-2", identity: "solo", station_id: 5, station: "你画我猜", status: "failed", score: 0, total: 43, at: ago(9) },
];

/* Relative to now, so the demo board shows a believable "已进行 22:00" instead
   of the hours-since-a-hardcoded-date the fixed timestamp produced. */
const STARTED_AT = new Date(Date.now() - 22 * 60 * 1000).toISOString();

export const SCREEN_PREVIEW: BoardSnapshot = {
  phase: "playing",
  started_at: STARTED_AT,
  stations_total: 7,
  stations,
  players,
  stats: { players: players.length, teams: 27, stamps: 237, life_events: 18, tokens_used: 11, top_score: players[0].score },
  awards: null,
  feed,
};

/**
 * Ceremony preview: /screen?preview=awards
 * 7 个奖，key 和 caption 的写法跟着 _event_awards 走（20260923000100_award_lineup.sql）：
 * 前三名来自三个不同的队 → 个人领奖台；最快通关跳过台上的队，caption 写分钟数；
 * 个人奖独行明星先发，再补天选之子 / 时运不济。
 */
export const SCREEN_AWARDS: BoardSnapshot["awards"] = {
  podium_mode: "player",
  podium: [
    { rank: 1, kind: "player", name: "林沐恩", score: 58, color_group: "red", identity: "duo", stations_done: 7, life_events: 3 },
    { rank: 2, kind: "player", name: "陈子谦", score: 55, color_group: "blue", identity: "trio", stations_done: 7, life_events: 3 },
    { rank: 3, kind: "player", name: "王心怡", score: 51, color_group: "violet", identity: "trio", stations_done: 7, life_events: 3 },
  ],
  specials: [
    { key: "solo_star", emoji: "⭐", title: "独行明星", subtitle: "独自出发里总分最高", caption: "独自出发，46 分", name: "吴佳音", color_group: "solo-2", identity: "solo", score: 46 },
    { key: "lucky", emoji: "🍀", title: "天选之子", subtitle: "际遇加分最多", caption: "际遇净赚 +14 分", name: "张乐言", color_group: "green", identity: "duo", score: 47 },
    { key: "unlucky", emoji: "🌧️", title: "时运不济", subtitle: "际遇扣分最多", caption: "际遇净亏 9 分", name: "何嘉树", color_group: "cyan", identity: "trio", score: 31 },
  ],
  team_awards: [
    { key: "fastest", emoji: "⚡", title: "最快通关", subtitle: "飞快走完所有站点", caption: "开局 38 分钟全部完成", members: "郑可欣 / 周以诺", member_count: 2, color_group: "orange", identity: "duo" },
  ],
};

/** /screen?preview=awards-team：前三里有两人同队 → 整场改成队伍领奖台，按平均分排。 */
export const SCREEN_AWARDS_TEAM: BoardSnapshot["awards"] = {
  ...SCREEN_AWARDS,
  podium_mode: "team",
  podium: [
    { rank: 1, kind: "team", name: "陈子谦 / 王心怡 / 黄恩慈", members: "陈子谦 / 王心怡 / 黄恩慈", member_count: 3, score: 55.3, color_group: "blue", identity: "trio", stations_done: 7, life_events: null },
    { rank: 2, kind: "team", name: "林沐恩 / 李俊熙", members: "林沐恩 / 李俊熙", member_count: 2, score: 52.5, color_group: "red", identity: "duo", stations_done: 7, life_events: null },
    { rank: 3, kind: "team", name: "吴佳音", members: "吴佳音", member_count: 1, score: 46, color_group: "solo-2", identity: "solo", stations_done: 7, life_events: null },
  ],
  specials: SCREEN_AWARDS!.specials.filter((award) => award.key !== "solo_star"),
};
