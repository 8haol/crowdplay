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
  score: Math.max(3, 58 - index - Math.floor(index / 4)),
  locked: index === 6 || index === 21,
  token_available: index % 6 !== 0,
  sick: index === 13,
  stations_done: Math.max(1, 7 - Math.floor(index / 9)),
}));

const feed: FeedItem[] = [
  { id: "f1", kind: "attempt", name: "林沐恩", station: "创意工坊", status: "passed", score: 9, total: 58, at: "2026-08-25T19:42:00Z" },
  { id: "f2", kind: "life_event", name: "黄恩慈", card: "fortune_plus3", label: "路上捡到 £10", threshold: 45, before: 45, after: 48, at: "2026-08-25T19:41:00Z" },
  { id: "f3", kind: "token", name: "张乐言", usage: "second_chance", station: "默契挑战", at: "2026-08-25T19:40:00Z" },
  { id: "f4", kind: "attempt", name: "王心怡", station: "人生选择", status: "passed", score: 6, total: 51, at: "2026-08-25T19:39:00Z" },
  { id: "f5", kind: "attempt", name: "吴佳音", station: "体能补给", status: "failed", score: 0, total: 43, at: "2026-08-25T19:38:00Z" },
];

export const SCREEN_PREVIEW: BoardSnapshot = {
  phase: "playing",
  started_at: "2026-08-25T19:00:00Z",
  players,
  stats: { players: players.length, stamps: 237, life_events: 18, tokens_used: 11, top_score: players[0].score },
  feed,
};
