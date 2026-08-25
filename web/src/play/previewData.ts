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
  player: {
    player_id: "preview-player",
    name: "林沐恩",
    code: "0427",
    identity: "trio",
    color_group: "teal",
    score: 38,
    token_available: true,
    locked_for_life_event: false,
    next_threshold: 45,
    pending_threshold: null,
    status_effect: null,
  },
  attempts: [
    { station_id: 1, status: "passed", score: 9, created_at: "2026-08-25T12:20:00.000Z" },
    { station_id: 2, status: "passed", score: 6, created_at: "2026-08-25T12:28:00.000Z" },
    { station_id: 3, status: "failed", score: 0, created_at: "2026-08-25T12:35:00.000Z" },
    { station_id: 3, status: "retry_granted", score: 0, created_at: "2026-08-25T12:42:00.000Z" },
    { station_id: 4, status: "passed", score: 6, created_at: "2026-08-25T12:48:00.000Z" },
  ],
  life_events: [
    {
      card_type: "fortune_plus3",
      card_label: "路上捡到 £10",
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
      player: {
        ...PREVIEW_DATA.player,
        score: 45,
        locked_for_life_event: true,
        pending_threshold: 45,
        next_threshold: null,
      },
    };
  }
  if (state === "ended") {
    return {
      ...PREVIEW_DATA,
      phase: "ended",
      rank: 3,
      player: { ...PREVIEW_DATA.player, score: 51, next_threshold: null, token_available: false },
    };
  }
  return PREVIEW_DATA;
}
