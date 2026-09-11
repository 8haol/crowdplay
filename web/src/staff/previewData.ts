import type { AwardTeamResult, PlayerState, StaffTeamLookup } from "../lib/types";

type StaffMember = PlayerState & { attempted_station_ids?: number[] };

/*
 * Fixtures for `/staff?preview=1`. The station screens are the hardest part of
 * the event to rehearse — a volunteer cannot practise without a live game and
 * the station password — so the demo mode walks the exact same three steps with
 * a made-up Trio and never touches the network.
 */
export const PREVIEW_STAFF_KEY = "preview";

const member = (
  name: string,
  code: string,
  score: number,
  stationsDone: number,
  lifeEventsDone: number,
  extra: Partial<StaffMember> = {},
): StaffMember => ({
  player_id: code,
  name,
  code,
  identity: "trio" as const,
  color_group: "navy",
  score,
  token_available: true,
  locked_for_life_event: false,
  status_effect: null,
  team_id: "preview-team",
  teammates: [],
  stations_done: stationsDone,
  stations_total: 7,
  life_events_done: lifeEventsDone,
  life_events_total: 3,
  pending_stage: null,
  next_event_stage: lifeEventsDone >= 3 ? null : lifeEventsDone + 1,
  next_event_after_station: lifeEventsDone >= 3 ? null : [3, 5, 7][lifeEventsDone],
  next_event_score: lifeEventsDone >= 3 ? null : [15, 35, 45][lifeEventsDone],
  attempted_station_ids: Array.from({ length: stationsDone }, (_, index) => index + 1),
  ...extra,
});

export const PREVIEW_TEAM: StaffTeamLookup = {
  found: true,
  identifier: "T03",
  phase: "playing",
  team_id: "preview-team",
  team_code: "T03",
  identity: "trio",
  color_group: "navy",
  challenge_score: 30,
  members: [
    member("林沐恩", "327", 33, 4, 1, { teammates: ["周以诺", "陈思语"] }),
    member("周以诺", "183", 30, 4, 1, { teammates: ["林沐恩", "陈思语"] }),
    member("陈思语", "273", 27, 4, 1, { teammates: ["林沐恩", "周以诺"], locked_for_life_event: true, pending_stage: 2 }),
  ],
  attempted_station_ids: [1, 2, 3, 4],
  retry_station_ids: [],
  failed_station_ids: [2],
  station_results: [
    { station_id: 1, score: 9, status: "passed" },
    { station_id: 2, score: 0, status: "failed" },
    { station_id: 3, score: 4, status: "passed" },
    { station_id: 4, score: 6, status: "passed" },
  ],
  all_tokens_available: true,
};

export function previewAward(stationScore: number, failed: boolean): AwardTeamResult {
  const awarded = failed ? 0 : stationScore;
  return {
    team_code: "T03",
    identity: "trio",
    status: failed ? "failed" : "passed",
    awarded,
    retry_used: false,
    challenge_score: 30 + awarded,
    members: (PREVIEW_TEAM.members ?? []).map((entry, index) => ({
      code: entry.code,
      name: entry.name,
      awarded,
      new_score: entry.score + awarded,
      // The fixture pretends this was station 5, which opens stage 2 for the
      // two members who were not already mid-event.
      life_event_triggered: !failed && index < 2,
      stage: !failed && index < 2 ? 2 : null,
      event_id: !failed && index < 2 ? `preview-event-${index}` : null,
    })),
  };
}
