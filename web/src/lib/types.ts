import { PASSPORT_COPY, type Copy } from "../theme/copy";

export type Phase = "waiting" | "playing" | "ended";
export type Identity = "solo" | "duo" | "trio" | null;

/** A church / host. Branding for every player-facing surface comes from here. */
export interface Organization {
  slug: string;
  name_zh: string;
  name_en: string;
}

/** What players and the projector may know about an event. Never carries a key. */
export interface GameSession {
  theme?: string;
  event_id: string;
  org_id?: string;
  title: string;
  join_token: string;
  join_open: boolean;
  phase: Phase;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  player_count: number;
  org?: Organization;
}

/** The admin view of the same event: the three keys that let people in. */
export interface AdminSession extends GameSession {
  staff_code: string;
  screen_token: string;
  /** When the host released the final ranks to the players' phones. */
  ranks_published_at?: string | null;
}

/** One row in the org's event list. */
export interface AdminEventSummary extends AdminSession {
  stamps: number;
  life_events: number;
  tokens_used: number;
  top_score: number;
}

export interface GameLanding extends Partial<GameSession> {
  is_current: boolean;
  invalid?: boolean;
  reason?: "NO_TOKEN" | "BAD_GAME_LINK";
}

export interface StaffSession {
  theme?: string;
  event_id: string;
  title: string;
  phase: Phase;
  org: Organization;
  /** The stations this event actually runs, enabled ones only — the same array
      `staff_stations` returns. Since phase 2 there is no global station list. */
  stations: EventStation[];
}

export interface AdminDashboardData {
  org: Organization & { id: string };
  events: AdminEventSummary[];
  live_event_id: string | null;
}

/**
 * One station's numbers inside one event. Deliberately NOT `extends Station`:
 * the payload comes from `_event_station_metrics`, which reads the per-event
 * snapshot (`event_stations`) — that table has no `slug`, because a slug
 * identifies a row in the org's library, not a station as this event ran it.
 */
export interface StationMetric {
  /** = `station_id`, so it keys the same things `Station.id` used to key. */
  id: number;
  station_id: number;
  name_zh: string;
  type: StationType;
  scoring_mode: ScoringMode;
  sort_order: number;
  /** Withdrawn mid-event: still listed with its numbers, no longer staffed. */
  disabled?: boolean;
  visits: number;
  passed: number;
  failed: number;
  score_awarded: number;
  completion_pct: number;
}

export interface AdminActivity {
  id: string;
  kind: "attempt" | "life_event" | "token" | "admin";
  at: string;
  player_name: string | null;
  player_code: string | null;
  label: string;
  detail: string;
}

export interface AdminConsoleData {
  org: Organization & { id: string };
  current: AdminSession;
  /** Every event this organisation has run, newest first. */
  events: AdminEventSummary[];
  stats: {
    players: number;
    teams: number;
    stamps: number;
    life_events: number;
    tokens_used: number;
    top_score: number;
    top_personal_score: number;
    locked_players: number;
    removed_players: number;
  };
  teams: TeamDetail[];
  station_metrics: StationMetric[];
  activity: AdminActivity[];
}

export interface AdminEventDetail {
  is_current: boolean;
  session: AdminSession;
  players: AdminPlayerDetail[];
  station_metrics: StationMetric[];
  activity: AdminActivity[];
  admin_log?: Array<{
    id: number;
    action: string;
    detail: unknown;
    reason: string | null;
    player_name: string | null;
    player_code: string | null;
    created_at: string;
  }>;
}

export interface PlayerState {
  player_id: string;
  name: string;
  code: string;
  identity: Identity;
  color_group: string | null;
  score: number;
  token_available: boolean;
  locked_for_life_event: boolean;
  status_effect: { type: string; value: number } | null;
  team_id: string | null;
  /** Teammate names. Replaced the short team code: a Duo/Trio is identified by
      who is standing there, and any member's own code resolves the team. */
  teammates: string[];
  /* Journey progress is counted in milestones, never in points: the passport
     bar fills across 7 stations + 3 life events. See the 20260828 migration. */
  stations_done: number;
  stations_total: number;
  life_events_done: number;
  life_events_total: number;
  /** Stage of the event currently waiting on this player's phone, if any. */
  pending_stage: number | null;
  /** 1 / 2 / 3, or null once all three stages are on the record. */
  next_event_stage: number | null;
  /** Completed stations that unlock `next_event_stage`. */
  next_event_after_station: number | null;
  /** Personal score that unlocks `next_event_stage` on its own. Whichever of
      the two gates arrives first fires the stage. */
  next_event_score: number | null;
}

/** Milestone counters shared by the passport header and the final badge. */
export function journeyProgress(player: PlayerState): {
  done: number;
  total: number;
  ratio: number;
  complete: boolean;
} {
  const total = player.stations_total + player.life_events_total;
  const done = Math.min(total, player.stations_done + player.life_events_done);
  return { done, total, ratio: total > 0 ? done / total : 0, complete: done >= total };
}

export interface TeamMemberSummary {
  name: string;
  score: number;
  token_available: boolean;
}

export interface TeamSummary {
  team_id: string;
  identity: Exclude<Identity, null>;
  color_group: string | null;
  challenge_score?: number;
  members: TeamMemberSummary[];
}

export interface TeamDetail extends TeamSummary {
  stations_done: number;
  pending_events: number;
  created_at: string;
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
  stage?: number | null;
  scene_title?: string | null;
  choice_label?: string | null;
  outcome_detail?: string | null;
  score_before: number;
  score_after: number;
  created_at: string;
}

export interface PendingLifeEvent {
  id: string;
  stage: number;
  title: string;
  prompt: string;
  emoji: string;
  choices: Array<{ key: string; label: string }>;
  created_at: string;
}

export interface LifeEventChoiceResult {
  event_id: string;
  stage: number;
  scene_title: string;
  choice_label: string;
  outcome_key: string;
  outcome_label: string;
  outcome_detail: string;
  tone: "good" | "bad" | "neutral";
  score_before: number;
  score_after: number;
  delta: number;
  next_event_stage: number | null;
  next_pending_event_id: string | null;
}

export interface PollResult {
  theme?: string;
  phase: Phase;
  started_at: string | null;
  /** Event title and organisation, so the passport cover and badge can brand themselves. */
  title?: string;
  org?: Organization;
  /** Null while the stage is still giving out the awards: the host publishes
      ranks as a second, separate step, and until then the server does not send
      them at all. */
  rank: number | null;
  team_rank?: number | null;
  ranks_published: boolean;
  player: PlayerState;
  team: TeamSummary | null;
  pending_event: PendingLifeEvent | null;
  attempts: AttemptInfo[];
  life_events: LifeEventInfo[];
  /** The stations this event runs, enabled ones only — what the passport's
      pages are drawn from. Names are the event's own snapshot, so a station
      renamed for tonight reads tonight's name. */
  stations: EventStation[];
}

export interface StaffTeamLookup {
  found: boolean;
  identifier?: string;
  phase?: Phase;
  event_title?: string;
  team_id?: string;
  /** Internal label only (audit rows, server error messages). Never shown. */
  team_code?: string;
  identity?: Exclude<Identity, null>;
  color_group?: string | null;
  challenge_score?: number;
  members?: Array<PlayerState & { attempted_station_ids?: number[] }>;
  attempted_station_ids?: number[];
  retry_station_ids?: number[];
  failed_station_ids?: number[];
  station_results?: Array<{ station_id: number; score: number; status: "passed" | "failed" }>;
  all_tokens_available?: boolean;
}

export interface AwardTeamResult {
  /** Internal label only. The UI names the team by its members. */
  team_code: string;
  identity: Exclude<Identity, null>;
  status: "passed" | "failed";
  awarded: number;
  retry_used: boolean;
  challenge_score?: number;
  members: Array<{
    code: string;
    name: string;
    awarded: number;
    new_score: number;
    life_event_triggered: boolean;
    stage: number | null;
    event_id: string | null;
  }>;
}

export type StationType = "main" | "life_event" | "grace";
export type ScoringMode = "graded" | "free" | "fixed" | null;

/**
 * One row of the station library: either a platform builtin (`org_id is null`)
 * or one this organisation created. It is a template, not something an event
 * runs — a station only reaches players once it is copied into an event.
 */
export interface Station {
  id: number;
  slug: string;
  name_zh: string;
  type: StationType;
  scoring_mode: ScoringMode;
  sort_order: number;
}

/**
 * One station as a single event runs it — the snapshot in `event_stations`.
 * Name and scoring mode are copies, so renaming the library row later never
 * rewrites what a past event recorded.
 *
 * `id`: the staff/board shapes (`staff_stations`, `_event_station_metrics`)
 * return `station_id` here, keeping the old `Station.id` meaning. The admin
 * shape (`admin_event_stations().rows`) returns the `event_stations` row's own
 * primary key instead — so anything that identifies a station across the two
 * must use `station_id`, which every shape carries.
 */
export interface EventStation {
  id: number;
  station_id: number;
  name_zh: string;
  type: StationType;
  scoring_mode: ScoringMode;
  sort_order: number;
  /** Non-null once the station was withdrawn mid-event. Scores already recorded stay. */
  disabled_at?: string | null;
}

/** The org's library, split by who owns each row. Builtins are read-only. */
export interface StationLibrary {
  builtin: Station[];
  custom: Station[];
}

/** `admin_event_stations`: this event's roster plus what else could join it. */
export interface EventStationsData {
  phase: Phase;
  rows: EventStation[];
  /** Library rows not yet on this event's roster. */
  candidates: Station[];
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
}

export interface AdminPlayer extends PlayerState {
  /** Optional admin-only follow-up contact; never included in player/staff/board payloads. */
  contact?: string | null;
  is_removed: boolean;
  created_at: string;
  attempt_count: number;
}

export interface AdminPlayerDetail extends AdminPlayer {
  attempts?: Array<AttemptInfo & { station_name?: string }>;
  life_events?: LifeEventInfo[];
  token_usages?: Array<{ usage_type: string; target_station_id: number | null; created_at: string }>;
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

export function colorOf(group: string | null, copy: Copy = PASSPORT_COPY): { hex: string; zh: string } | null {
  if (!group) return null;
  /* 色号（slug）是数据库里的身份，跨主题不变；每个主题只换它长什么样、叫什么名。 */
  const map = copy.colors ?? COLOR_MAP;
  const solos = copy.soloColors ?? SOLO_COLORS;
  if (group === "solo" || group.startsWith("solo-")) {
    const parsed = Number(group.split("-")[1] ?? "1");
    const slot = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    return {
      hex: solos[(slot - 1) % solos.length],
      zh: `${copy.soloColorLabel} ${String(slot).padStart(2, "0")}`,
    };
  }
  const base = group.split("-")[0];
  const c = map[base];
  if (!c) return { hex: "#888888", zh: group };
  const suffix = group.includes("-") ? ` ${group.split("-")[1]} 组` : "";
  return { hex: c.hex, zh: c.zh + suffix };
}

/** Stable visual fallback for Solo records created before the Solo-color migration. */
export function soloColor(seed: string, copy: Copy = PASSPORT_COPY): { hex: string; zh: string } {
  const solos = copy.soloColors ?? SOLO_COLORS;
  const hash = Array.from(seed).reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 0);
  const slot = (hash % solos.length) + 1;
  return { hex: solos[slot - 1], zh: `${copy.soloColorLabel} ${String(slot).padStart(2, "0")}` };
}

export const IDENTITY_SHORT: Record<string, string> = Object.fromEntries(
  Object.entries(PASSPORT_COPY.identity).map(([key, { short }]) => [key, short]),
);

/**
 * How a team is named now that short team codes are gone from the product.
 * A Duo/Trio is "its colour + its size" — the same two things its members see
 * on their own phones when they hold them up to find each other.
 */
export function teamLabel(colorGroup: string | null, identity: Identity, seed = "", copy: Copy = PASSPORT_COPY): string {
  const color = colorOf(colorGroup, copy) ?? (identity === "solo" ? soloColor(seed, copy) : null);
  const size = identity ? copy.teamName[identity] : "未分配";
  return color ? `${color.zh} · ${size}` : size;
}

export const IDENTITY_ZH: Record<string, { name: string; desc: string }> = Object.fromEntries(
  Object.entries(PASSPORT_COPY.identity).map(([key, { name, desc }]) => [key, { name, desc }]),
);

// ---------------------------------------------------------------------------
// Big-screen board (/screen). Never carries 4-digit codes: the payload is
// projected in a public room and the code is an identity credential.
// ---------------------------------------------------------------------------
export interface BoardPlayer {
  id: string;
  name: string;
  team_id: string | null;
  member_count?: number;
  identity: Identity;
  color_group: string | null;
  score: number;
  locked: boolean;
  token_available: boolean;
  sick: boolean;
  stations_done: number;
  life_events_done: number;
}

export type FeedItem =
  | {
      id: string;
      kind: "life_event";
      name: string;
      card: string;
      /** Outcome headline, e.g. 「小小试验打开了新方向」 */
      label: string;
      /** Scene the player was handed, e.g. 「独自面试等待」 */
      scene: string | null;
      /** Action the player picked. */
      choice: string | null;
      outcome: string | null;
      stage: number | null;
      before: number;
      after: number;
      at: string;
    }
  | {
      id: string;
      kind: "attempt";
      /** Team member names joined with " / ", or one name for a Solo. */
      name: string;
      /** Which station; null for the hidden one. Themes map it to a booth alias. */
      station_id?: number | null;
      color_group?: string | null;
      identity?: Identity;
      station: string;
      status: "passed" | "failed";
      score: number;
      total?: number;
      at: string;
    }
  | {
      id: string;
      kind: "token";
      name: string;
      usage: "hint" | "second_chance" | "grace_card";
      station: string | null;
      station_id?: number | null;
      at: string;
    };

/**
 * One podium place. When two of the individual top three share a team (and the
 * event has at least three teams) the whole podium switches to teams: `kind` is
 * "team", `name` is the member list and `score` is the members' average.
 * Payloads from before 20260923000300_award_lineup have no `kind` — treat as player.
 */
export interface PodiumEntry {
  rank: number;
  kind?: "player" | "team";
  name: string;
  score: number;
  color_group: string | null;
  identity: Identity;
  stations_done: number;
  life_events: number | null;
  members?: string;
  member_count?: number;
}

/** Award decided by a metric that differs between teammates. */
export interface SpecialAward {
  key: string;
  emoji: string;
  title: string;
  subtitle: string;
  caption: string;
  name: string;
  color_group: string | null;
  identity: Identity;
  score: number;
}

/** Award decided by the station run, which is scored once per team. */
export interface TeamAward {
  key: string;
  emoji: string;
  title: string;
  subtitle: string;
  caption: string;
  members: string;
  member_count: number;
  color_group: string | null;
  identity: Exclude<Identity, null>;
}

export interface BoardAwards {
  podium: PodiumEntry[];
  podium_mode?: "player" | "team";
  specials: SpecialAward[];
  team_awards: TeamAward[];
}

export interface BoardSnapshot {
  theme?: string;
  /** One call carries everything the projector needs; there is no second poll. */
  event_id?: string;
  title?: string;
  join_token?: string;
  join_open?: boolean;
  org?: Organization;
  phase: Phase;
  started_at: string | null;
  stations_total: number;
  /** Visible main stations in order, so the projector can apply the theme's booth aliases. */
  stations?: BoardStation[];
  players: BoardPlayer[];
  stats: {
    players: number;
    teams?: number;
    stamps: number;
    life_events: number;
    tokens_used: number;
    top_score: number;
  };
  awards: BoardAwards | null;
  feed: FeedItem[];
}

export type LifeEventAudience = "all" | "solo" | "duo" | "trio";

export interface LifeEventOutcomeDefinition {
  key: string;
  label: string;
  detail: string;
  delta?: number;
  multiplier?: number;
  weight: number;
  tone: "good" | "bad" | "neutral";
}

export interface LifeEventChoiceDefinition {
  key: string;
  label: string;
  outcomes: LifeEventOutcomeDefinition[];
}

export interface LifeEventSceneDefinition {
  key: string;
  audience: LifeEventAudience;
  /** null / missing = 各主题通用；否则只在 events.theme 相同的场次里抽到。 */
  theme?: string | null;
  title: string;
  prompt: string;
  emoji: string;
  choices: LifeEventChoiceDefinition[];
  active: boolean;
  sort_order: number;
}

export interface LifeEventCatalog {
  stats: {
    scenes: number;
    choices: number;
    outcomes: number;
    by_audience: Record<LifeEventAudience, number>;
    /** `shared` = 通用场景数；其余键是主题 id。迁移落地前可能缺失。 */
    by_theme?: Record<string, number>;
  };
  scenes: LifeEventSceneDefinition[];
}

/* ---------- 阶段 3 · 超级管理员控制台 ---------- */

export interface PlatformOrg {
  id: string;
  slug: string;
  name_zh: string;
  name_en: string;
  // 明文管理口令，业主拍板要能在 /root 里看到。null = 从没记录过（这间机构
  // 的口令是迁移前设的，只存了哈希，明文永久丢了），要重置口令才会有值。
  admin_key_plain: string | null;
  created_at: string;
  event_count: number;
  last_event_at: string | null;
  has_live_event: boolean;
  // 活动相册用量与额度（字节）。可选：前端可能先于 schema 上线（Netlify 合并即部署，
  // db push 是手动的），旧版 platform_orgs 不返回这两个字段时显示「—」而不是 NaN。
  album_used_bytes?: number;
  album_quota_bytes?: number;
}

export interface PlatformOrgs {
  orgs: PlatformOrg[];
}

export interface ImpersonateResult {
  token: string;
  org_name: string;
}

/* ---------- 后台按站改分 / 隐藏摊位（2026-09-21 追加，只在这里追加，不改上面的接口） ---------- */

/** `admin_player_attempts`: one row per enabled main station, unplayed ones carry nulls. */
export interface PlayerAttemptRow {
  station_id: number;
  name_zh: string;
  scoring_mode: ScoringMode;
  score: number | null;
  status: "passed" | "failed" | null;
}

/**
 * `stations.hidden` / `stations.hint`, copied onto `event_stations`. A hidden
 * station is the secret NPC: always `main` + `fixed`, never counted toward the
 * station total, and `hint` is what players read once the visible mains are
 * all stamped. Admin code intersects this with `Station` / `EventStation`.
 */
export interface StationHiddenFields {
  hidden?: boolean;
  hint?: string | null;
}

/* ---------- 玩家端：撞名登记、联系方式找回、月圆时刻（2026-09-21 追加，只在这里追加） ---------- */

/** `join_by_link` found someone tonight with the same normalised name. */
export interface DuplicateJoin {
  name: string;
  /** First digit shown, the rest masked: 「3●●」. */
  code_hint: string;
  has_contact: boolean;
  contact_hint: string | null;
}

/** `join_by_link`: a fresh player, or a duplicate card to confirm first. */
export type JoinResult = { player_id: string; code: string } | { duplicate: DuplicateJoin };

/** `recover_by_link` / `recover_by_contact`: the player json, code and name. */
export interface RecoveredPlayer {
  code: string;
  name: string;
}

/** `poll_player_by_link.full_moon`: every visible main station stamped. */
export interface FullMoonState {
  reached: boolean;
  /** The hidden station's hint, or null when the event runs none. */
  hint: string | null;
  secret_done: boolean;
}

// Declaration merging: `PollResult` above gains the optional block without
// touching the original interface.
export interface PollResult {
  full_moon?: FullMoonState;
}

/** An attempt feed row at the hidden station: the board says 「找到了神秘嘉宾」 and hides the station name. */
export interface SecretFeedFlag {
  secret?: boolean;
}

/** One visible main station as `board_snapshot.stations` lists it. */
export interface BoardStation {
  station_id: number;
  name_zh: string;
  sort_order: number;
}
