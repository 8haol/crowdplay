export type Phase = "waiting" | "playing" | "ended";
export type Identity = "solo" | "duo" | "trio" | null;

export interface PlayerState {
  player_id: string;
  name: string;
  code: string;
  identity: Identity;
  color_group: string | null;
  score: number;
  token_available: boolean;
  locked_for_life_event: boolean;
  next_threshold: number | null;
  pending_threshold: number | null;
  status_effect: { type: string; value: number } | null;
}

export interface AttemptInfo {
  station_id: number;
  status: "passed" | "failed" | "retry_granted";
  score: number;
  created_at: string;
}

export interface LifeEventInfo {
  card_type: string;
  card_label: string;
  score_before: number;
  score_after: number;
  created_at: string;
}

export interface PollResult {
  phase: Phase;
  started_at: string | null;
  rank: number;
  player: PlayerState;
  attempts: AttemptInfo[];
  life_events: LifeEventInfo[];
}

export interface Station {
  id: number;
  slug: string;
  name_zh: string;
  type: "main" | "life_event" | "grace";
  scoring_mode: "graded" | "fixed" | null;
  sort_order: number;
}

export interface AwardResultEntry {
  code: string;
  name: string;
  status: "passed" | "failed";
  awarded: number;
  cap_applied: boolean;
  new_score: number;
  life_event_triggered: boolean;
  threshold: number | null;
}

export interface StaffLookupEntry extends Partial<PlayerState> {
  code: string;
  found: boolean;
  attempted_station_ids?: number[];
  retry_station_ids?: number[];
  failed_station_ids?: number[];
}

export interface LifeEventResult {
  code: string;
  name: string;
  card_type: string;
  card_label: string;
  score_before: number;
  score_after: number;
  next_threshold: number | null;
}

export interface AdminPlayer extends PlayerState {
  is_removed: boolean;
  created_at: string;
  attempt_count: number;
}

export const CARDS: { type: string; label: string; effect: string; tone: "good" | "bad" | "neutral" }[] = [
  { type: "fortune_double", label: "Essay 拿了 First Class!", effect: "总分 ×2", tone: "good" },
  { type: "fortune_plus3", label: "路上捡到 £10", effect: "总分 +3", tone: "good" },
  { type: "bad_minus5", label: "被锁在 Flat 门外", effect: "总分 -5", tone: "bad" },
  { type: "bad_cap_next", label: "重感冒卧床", effect: "下一站最多得 1 分", tone: "bad" },
  { type: "unexpected_married", label: "Got Married!", effect: "记录，分数不变", tone: "neutral" },
  { type: "extreme_half", label: "投资暴雷", effect: "总分减半", tone: "bad" },
];

/** color_group slug -> display. Suffixed groups ("red-2") reuse the base color. */
const COLOR_MAP: Record<string, { hex: string; zh: string }> = {
  red: { hex: "#E02E24", zh: "正红" },
  violet: { hex: "#B48CE0", zh: "紫藤" },
  pink: { hex: "#F27BB4", zh: "粉" },
  rose: { hex: "#D81B60", zh: "玫红" },
  maroon: { hex: "#7A1230", zh: "酒红" },
  fuchsia: { hex: "#C43FA0", zh: "玫紫" },
  purple: { hex: "#8A3FBF", zh: "紫" },
  plum: { hex: "#4A1D66", zh: "深紫" },
  indigo: { hex: "#5A4FCF", zh: "靛" },
  navy: { hex: "#1B2E6B", zh: "藏青" },
  blue: { hex: "#1D5FBF", zh: "深蓝" },
  sky: { hex: "#4FB3E8", zh: "天蓝" },
  cyan: { hex: "#17A2A8", zh: "青" },
  teal: { hex: "#145C4A", zh: "墨松" },
  green: { hex: "#1E7A34", zh: "深绿" },
  mint: { hex: "#4ECB8D", zh: "薄荷" },
  lime: { hex: "#7BC244", zh: "草绿" },
  olive: { hex: "#8A8A1E", zh: "橄榄" },
  yellow: { hex: "#F2D01E", zh: "柠檬" },
  gold: { hex: "#B8862B", zh: "金棕" },
  orange: { hex: "#FF8A3C", zh: "橙" },
  coral: { hex: "#8A5A2B", zh: "棕" },
  amber: { hex: "#B8A87A", zh: "卡其" },
  emerald: { hex: "#8A8A8A", zh: "灰" },
};

/* Solo players receive related terracotta shades. They read as one distinct
   identity family, while the numbered label prevents anyone mistaking them
   for a Duo/Trio team that needs to find matching partners. */
const SOLO_COLORS = [
  "#7D4E43", "#925A4C", "#A66555", "#B87260",
  "#C67F6C", "#D18D79", "#A95747", "#BC6653",
];

export function colorOf(group: string | null): { hex: string; zh: string } | null {
  if (!group) return null;
  if (group === "solo" || group.startsWith("solo-")) {
    const parsed = Number(group.split("-")[1] ?? "1");
    const slot = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    return {
      hex: SOLO_COLORS[(slot - 1) % SOLO_COLORS.length],
      zh: `独行色 ${String(slot).padStart(2, "0")}`,
    };
  }
  const base = group.split("-")[0];
  const c = COLOR_MAP[base];
  if (!c) return { hex: "#888888", zh: group };
  const suffix = group.includes("-") ? ` ${group.split("-")[1]} 组` : "";
  return { hex: c.hex, zh: c.zh + suffix };
}

/** Stable visual fallback for Solo records created before the Solo-color migration. */
export function soloColor(seed: string): { hex: string; zh: string } {
  const hash = Array.from(seed).reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 0);
  const slot = (hash % SOLO_COLORS.length) + 1;
  return { hex: SOLO_COLORS[slot - 1], zh: `独行色 ${String(slot).padStart(2, "0")}` };
}

export const IDENTITY_ZH: Record<string, { name: string; desc: string }> = {
  solo: { name: "Solo 独行者", desc: "这一程你独自上路——但记得，恩典站永远为你开着。" },
  duo: { name: "Duo 同行二人", desc: "去找和你同色的那个人，接下来一起闯关！" },
  trio: { name: "Trio 三人同行", desc: "去找和你同色的两位伙伴，接下来一起闯关！" },
};

// ---------------------------------------------------------------------------
// Big-screen board (/screen). Never carries 4-digit codes: the payload is
// projected in a public room and the code is an identity credential.
// ---------------------------------------------------------------------------
export interface BoardPlayer {
  id: string;
  name: string;
  identity: Identity;
  color_group: string | null;
  score: number;
  locked: boolean;
  token_available: boolean;
  sick: boolean;
  stations_done: number;
}

export type FeedItem =
  | {
      id: string;
      kind: "life_event";
      name: string;
      card: string;
      label: string;
      threshold: number | null;
      before: number;
      after: number;
      at: string;
    }
  | {
      id: string;
      kind: "attempt";
      name: string;
      station: string;
      status: "passed" | "failed";
      score: number;
      total: number;
      at: string;
    }
  | {
      id: string;
      kind: "token";
      name: string;
      usage: "hint" | "second_chance" | "grace_card";
      station: string | null;
      at: string;
    };

export interface BoardSnapshot {
  phase: Phase;
  started_at: string | null;
  players: BoardPlayer[];
  stats: {
    players: number;
    stamps: number;
    life_events: number;
    tokens_used: number;
    top_score: number;
  };
  feed: FeedItem[];
}
