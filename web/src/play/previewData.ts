import type { PollResult, Station } from "../lib/types";

export const PREVIEW_STATIONS: Station[] = [
  { id: 1, slug: "memory", name_zh: "记忆与观察", type: "main", scoring_mode: "graded", sort_order: 1 },
  { id: 2, slug: "music", name_zh: "音乐之声", type: "main", scoring_mode: "graded", sort_order: 2 },
  { id: 3, slug: "british", name_zh: "英伦百事通", type: "main", scoring_mode: "graded", sort_order: 3 },
  { id: 4, slug: "teamwork", name_zh: "同心协力", type: "main", scoring_mode: "fixed", sort_order: 4 },
  { id: 5, slug: "language", name_zh: "你画我猜", type: "main", scoring_mode: "graded", sort_order: 5 },
  { id: 6, slug: "balance", name_zh: "人生平衡", type: "main", scoring_mode: "fixed", sort_order: 6 },
  { id: 7, slug: "journey", name_zh: "旅途抉择", type: "main", scoring_mode: "graded", sort_order: 7 },
];

export const PREVIEW_DATA: PollResult = {
  phase: "playing",
  started_at: "2026-08-25T12:00:00.000Z",
  rank: 3,
  team_rank: 2,
  player: {
    player_id: "preview-player",
    name: "林沐恩",
    code: "427",
    identity: "trio",
    color_group: "teal",
    score: 38,
    token_available: true,
    locked_for_life_event: false,
    status_effect: null,
    team_id: "preview-team",
    teammates: ["周以诺", "陈思语"],
    stations_done: 4,
    stations_total: 7,
    life_events_done: 1,
    life_events_total: 3,
    pending_stage: null,
    next_event_stage: 2,
    next_event_after_station: 5,
    next_event_score: 35,
  },
  team: { team_id: "preview-team", identity: "trio", color_group: "teal", challenge_score: 35, members: [{ name: "林沐恩", score: 38, token_available: true }, { name: "周以诺", score: 35, token_available: true }, { name: "陈思语", score: 32, token_available: true }] },
  pending_event: null,
  attempts: [
    { station_id: 1, status: "passed", score: 9, created_at: "2026-08-25T12:20:00.000Z" },
    { station_id: 2, status: "passed", score: 6, created_at: "2026-08-25T12:28:00.000Z" },
    { station_id: 3, status: "failed", score: 0, created_at: "2026-08-25T12:35:00.000Z" },
    { station_id: 3, status: "retry_granted", score: 0, created_at: "2026-08-25T12:42:00.000Z" },
    { station_id: 4, status: "passed", score: 6, created_at: "2026-08-25T12:48:00.000Z" },
  ],
  life_events: [
    {
      card_type: "choice_all_wallet",
      card_label: "路上捡到 £10",
      stage: 1,
      scene_title: "捡到钱包",
      choice_label: "先交给失物处",
      outcome_detail: "失主留下一句谢谢和一张 £10 的谢礼，你觉得这一天值了。",
      score_before: 15,
      score_after: 18,
      created_at: "2026-08-25T12:30:00.000Z",
    },
  ],
};

export function previewState(state: string): PollResult {
  if (state === "duo") {
    return {
      ...PREVIEW_DATA,
      player: {
        ...PREVIEW_DATA.player,
        identity: "duo",
        color_group: "orange",
      },
    };
  }
  if (state === "solo") {
    return {
      ...PREVIEW_DATA,
      player: {
        ...PREVIEW_DATA.player,
        identity: "solo",
        color_group: "solo-3",
      },
    };
  }
  if (state === "sick") {
    return {
      ...PREVIEW_DATA,
      player: {
        ...PREVIEW_DATA.player,
        status_effect: { type: "cap_next", value: 1 },
      },
    };
  }
  if (state === "lock") {
    return {
      ...PREVIEW_DATA,
      pending_event: { id: "preview-event", stage: 2, title: "三份完全不同的建议", prompt: "你遇到一个难题，两位队友和你自己的直觉给出三种相反答案。", emoji: "🔀", choices: [{ key: "combine", label: "找出三种建议的共同点" }, { key: "choose", label: "相信第一直觉，自己决定" }], created_at: new Date().toISOString() },
      player: {
        ...PREVIEW_DATA.player,
        score: 45,
        locked_for_life_event: true,
        stations_done: 5,
        pending_stage: 2,
        next_event_stage: 2,
        next_event_after_station: 5,
        next_event_score: 35,
      },
    };
  }
  if (state === "ended") {
    return {
      ...PREVIEW_DATA,
      phase: "ended",
      rank: 3,
      player: {
        ...PREVIEW_DATA.player,
        score: 51,
        token_available: false,
        stations_done: 7,
        life_events_done: 3,
        next_event_stage: null,
        next_event_after_station: null,
        next_event_score: null,
      },
    };
  }
  return PREVIEW_DATA;
}
