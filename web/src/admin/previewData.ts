import type {
  AdminConsoleData,
  AdminEventDetail,
  AdminDashboardData,
  AdminPlayer,
  EventStationsData,
  Station,
  StationLibrary,
  StationMetric,
} from "../lib/types";

/** Dev-only fixture for `/admin?preview=1`, so layout work needs no live event. */
export interface AdminSnapshot {
  consoleData: AdminConsoleData;
  players: AdminPlayer[];
}

const now = new Date("2026-08-27T18:40:00Z").toISOString();

const player = (
  name: string,
  code: string,
  score: number,
  stationsDone: number,
  lifeEventsDone: number,
  extra: Partial<AdminPlayer> = {},
): AdminPlayer => ({
  player_id: code,
  name,
  code,
  identity: "solo",
  color_group: `solo-${(Number(code) % 8) + 1}`,
  score,
  token_available: true,
  locked_for_life_event: false,
  status_effect: null,
  team_id: `team-${code}`,
  teammates: [],
  stations_done: stationsDone,
  stations_total: 7,
  life_events_done: lifeEventsDone,
  life_events_total: 3,
  pending_stage: null,
  next_event_stage: lifeEventsDone >= 3 ? null : lifeEventsDone + 1,
  next_event_after_station: lifeEventsDone >= 3 ? null : [3, 5, 7][lifeEventsDone],
  next_event_score: lifeEventsDone >= 3 ? null : [15, 35, 45][lifeEventsDone],
  is_removed: false,
  created_at: now,
  attempt_count: stationsDone,
  ...extra,
});

const PLAYERS: AdminPlayer[] = [
  player("林沐恩", "327", 48, 7, 3, { contact: "WeChat: muen427", identity: "duo", color_group: "navy", team_id: "t1", teammates: ["周以诺"] }),
  player("周以诺", "183", 42, 6, 2, { contact: "+44 7700 900183", identity: "duo", color_group: "navy", team_id: "t1", teammates: ["林沐恩"] }),
  player("陈思语", "273", 37, 5, 1, {
    identity: "trio",
    color_group: "coral",
    team_id: "t2",
    teammates: ["何嘉树", "郑思源"],
    locked_for_life_event: true,
    pending_stage: 2,
  }),
  player("梁乐知", "591", 31, 4, 1, { token_available: false, team_id: "t3", color_group: "solo-2" }),
  player("测试账号", "901", 0, 0, 0, { is_removed: true, team_id: "t4", color_group: "solo-5" }),
];

const STATIONS: StationMetric[] = [
  { id: 1, station_id: 1, name_zh: "音乐之声", type: "main", scoring_mode: "graded", sort_order: 1, visits: 34, passed: 29, failed: 5, score_awarded: 198, completion_pct: 72.3 },
  { id: 2, station_id: 2, name_zh: "英伦百事通", type: "main", scoring_mode: "graded", sort_order: 2, visits: 28, passed: 20, failed: 8, score_awarded: 147, completion_pct: 59.6 },
  { id: 3, station_id: 3, name_zh: "灵魂拷问", type: "main", scoring_mode: "free", sort_order: 3, visits: 22, passed: 17, failed: 5, score_awarded: 121, completion_pct: 46.8 },
  { id: 4, station_id: 4, name_zh: "定格瞬间", type: "main", scoring_mode: "fixed", sort_order: 4, visits: 19, passed: 18, failed: 1, score_awarded: 108, completion_pct: 40.4 },
  { id: 5, station_id: 5, name_zh: "记忆与观察", type: "main", scoring_mode: "graded", sort_order: 5, visits: 14, passed: 10, failed: 4, score_awarded: 72, completion_pct: 29.8 },
  { id: 6, station_id: 6, name_zh: "套圈", type: "main", scoring_mode: "graded", sort_order: 6, visits: 11, passed: 7, failed: 4, score_awarded: 48, completion_pct: 23.4 },
  { id: 7, station_id: 7, name_zh: "寂静图书馆", type: "main", scoring_mode: "graded", sort_order: 7, visits: 8, passed: 6, failed: 2, score_awarded: 39, completion_pct: 17.0, disabled: true },
  { id: 8, station_id: 8, name_zh: "人生盲盒", type: "life_event", scoring_mode: null, sort_order: 8, visits: 26, passed: 0, failed: 0, score_awarded: 0, completion_pct: 0 },
  { id: 9, station_id: 9, name_zh: "恩典站", type: "grace", scoring_mode: null, sort_order: 9, visits: 9, passed: 0, failed: 0, score_awarded: 0, completion_pct: 0 },
];

/* The library every org starts from: the nine platform builtins, read-only. */
const BUILTIN: Station[] = [
  { id: 1, slug: "music", name_zh: "音乐之声", type: "main", scoring_mode: "graded", sort_order: 1 },
  { id: 2, slug: "uk-life", name_zh: "英伦百事通", type: "main", scoring_mode: "graded", sort_order: 2 },
  { id: 3, slug: "interview", name_zh: "灵魂拷问", type: "main", scoring_mode: "free", sort_order: 3 },
  { id: 4, slug: "photo", name_zh: "定格瞬间", type: "main", scoring_mode: "fixed", sort_order: 4 },
  { id: 5, slug: "memory", name_zh: "记忆与观察", type: "main", scoring_mode: "graded", sort_order: 5 },
  { id: 6, slug: "ring-toss", name_zh: "套圈", type: "main", scoring_mode: "graded", sort_order: 6 },
  { id: 7, slug: "library", name_zh: "寂静图书馆", type: "main", scoring_mode: "graded", sort_order: 7 },
  { id: 8, slug: "life-event", name_zh: "人生盲盒", type: "life_event", scoring_mode: null, sort_order: 8 },
  { id: 9, slug: "grace", name_zh: "恩典站", type: "grace", scoring_mode: null, sort_order: 9 },
];

/** `/admin?preview=1&view=stations` — the library and this event's roster. */
export const PREVIEW_LIBRARY: StationLibrary = {
  builtin: BUILTIN,
  custom: [
    { id: 40, slug: "gcgc-8f21ac", name_zh: "默契挑战", type: "main", scoring_mode: "fixed", sort_order: 100 },
    { id: 41, slug: "gcgc-2b70d9", name_zh: "厨房里的家乡", type: "main", scoring_mode: "free", sort_order: 101 },
  ],
};

export const PREVIEW_EVENT_STATIONS: EventStationsData = {
  phase: "playing",
  rows: STATIONS.map((station) => ({
    id: station.station_id,
    station_id: station.station_id,
    name_zh: station.name_zh,
    type: station.type,
    scoring_mode: station.scoring_mode,
    sort_order: station.sort_order,
    disabled_at: station.disabled ? now : null,
  })),
  candidates: PREVIEW_LIBRARY.custom,
};

export const ADMIN_PREVIEW: AdminSnapshot = {
  players: PLAYERS,
  consoleData: {
    org: { id: "preview-org", slug: "gcgc", name_zh: "格拉斯哥华人福音教会", name_en: "Glasgow Chinese Gospel Church" },
    current: {
      event_id: "preview-event-0000-0000",
      title: "2026 Glasgow 新生迎新会",
      join_token: "8f23e7c51a9d4b60",
      staff_code: "K7M2PX",
      screen_token: "3c1e9a4d7b2f8e60",
      join_open: true,
      phase: "playing",
      created_at: now,
      started_at: now,
      ended_at: null,
      player_count: 47,
    },
    events: [
      { event_id: "preview-event-0000-0000", title: "2026 Glasgow 新生迎新会", join_token: "8f23e7c51a9d4b60", staff_code: "K7M2PX", screen_token: "3c1e9a4d7b2f8e60", join_open: true, phase: "playing", created_at: now, started_at: now, ended_at: null, player_count: 47, stamps: 68, life_events: 26, tokens_used: 9, top_score: 48 },
      { event_id: "archive-1", title: "2025 圣诞欢乐夜", join_token: "a1b2c3d4e5f60718", staff_code: "QW8ZT3", screen_token: "9f8e7d6c5b4a3210", join_open: false, phase: "ended", created_at: "2025-12-20T18:00:00Z", started_at: "2025-12-20T19:05:00Z", ended_at: "2025-12-20T20:20:00Z", player_count: 38, top_score: 54, stamps: 61, life_events: 22, tokens_used: 12 },
      { event_id: "archive-2", title: "2025 秋季新生迎新会", join_token: "0f1e2d3c4b5a6978", staff_code: "HN4V2R", screen_token: "5a6b7c8d9e0f1122", join_open: false, phase: "ended", created_at: "2025-09-14T17:30:00Z", started_at: "2025-09-14T18:40:00Z", ended_at: "2025-09-14T20:00:00Z", player_count: 52, top_score: 61, stamps: 84, life_events: 31, tokens_used: 18 },
    ],
    stats: {
      players: 47,
      teams: 23,
      stamps: 68,
      life_events: 26,
      tokens_used: 9,
      top_score: 48,
      top_personal_score: 48,
      locked_players: 1,
      removed_players: 1,
    },
    teams: [
      { team_id: "t1", identity: "duo", color_group: "navy", stations_done: 7, pending_events: 0, created_at: now, members: [{ name: "林沐恩", score: 48, token_available: true }, { name: "周以诺", score: 42, token_available: true }] },
      { team_id: "t2", identity: "trio", color_group: "coral", stations_done: 5, pending_events: 1, created_at: now, members: [{ name: "陈思语", score: 37, token_available: true }, { name: "何嘉树", score: 39, token_available: true }, { name: "郑思源", score: 35, token_available: false }] },
      { team_id: "t3", identity: "solo", color_group: "solo-2", stations_done: 4, pending_events: 0, created_at: now, members: [{ name: "梁乐知", score: 31, token_available: false }] },
    ],
    station_metrics: STATIONS,
    activity: [
      { id: "a1", kind: "attempt", at: now, player_name: "林沐恩 / 周以诺", player_code: null, label: "寂静图书馆", detail: "全队每人 +9 分" },
      { id: "a2", kind: "life_event", at: now, player_name: "陈思语", player_code: "273", label: "三人投票僵局", detail: "小小试验打开了新方向" },
      { id: "a3", kind: "token", at: now, player_name: "梁乐知", player_code: "591", label: "Help Token", detail: "grace_card" },
    ],
  },
};

/*
 * 后台拆成两层之后，演示数据也跟着拆：机构层只需要 admin_dashboard 的形状，
 * 活动层才需要 admin_console + 玩家名单。ADMIN_PREVIEW 保留给活动层复用。
 */
export interface OrgPreview {
  dashboard: AdminDashboardData;
}

export type EventPreview = AdminSnapshot;

export const EVENT_PREVIEW: EventPreview = ADMIN_PREVIEW;

/*
 * 「本场概览」自己拉 admin_event_detail，所以演示模式下它以前永远停在
 * 「正在读取场次…」——说明页里那一页 demo 是死的。它要的字段 ADMIN_PREVIEW
 * 全都有，只是形状不同，这里换个形状给它。
 */
export const EVENT_DETAIL_PREVIEW: AdminEventDetail = {
  is_current: true,
  session: ADMIN_PREVIEW.consoleData.current,
  players: ADMIN_PREVIEW.players,
  station_metrics: ADMIN_PREVIEW.consoleData.station_metrics,
  activity: ADMIN_PREVIEW.consoleData.activity,
  admin_log: [],
};

export const ORG_PREVIEW: OrgPreview = {
  dashboard: {
    org: ADMIN_PREVIEW.consoleData.org,
    live_event_id: ADMIN_PREVIEW.consoleData.current.event_id,
    events: ADMIN_PREVIEW.consoleData.events,
  },
};
