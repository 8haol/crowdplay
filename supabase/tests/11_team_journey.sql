-- V2 regression: one team result, dual scores, non-blocking private events,
-- hidden randomized outcomes, and all-member token cost.
begin;
delete from rpc_results; delete from admin_actions; delete from token_usages;
delete from life_events; delete from life_event_instances; delete from attempts;
delete from team_attempts; delete from players; delete from teams;
update app_config set value = 'team-admin' where key = 'admin_key';
update app_config set value = 'team-staff' where key = 'staff_key';
update game_state set phase = 'waiting', join_passphrase = 'team-pass',
  join_open = true, started_at = null, ended_at = null where id = 1;

do $$
declare
  v_stations int[] := (select array_agg(id order by sort_order) from stations where type = 'main');
  v_token text := (select join_token from game_state where id = 1);
  r jsonb;
  lookup jsonb;
  pending jsonb;
  event_result jsonb;
  trio_code text;
  member_code text;
  choice_key text;
begin
  insert into players (name, code) values
    ('甲', '8101'), ('乙', '8102'), ('丙', '8103'),
    ('丁', '8104'), ('戊', '8105'), ('己', '8106');

  r := start_game('team-admin', '{"trio":1,"duo":1}'::jsonb);
  assert (r ->> 'total_teams')::int = 3, 'trio + duo + solo = 3 teams';
  assert (select count(*) from teams where identity = 'trio') = 1, 'trio created';
  assert (select count(*) from teams where identity = 'duo') = 1, 'duo created';
  assert (select count(*) from teams where identity = 'solo') = 1, 'solo created';

  select t.code, min(p.code) into trio_code, member_code
  from teams t join players p on p.team_id = t.id
  where t.identity = 'trio' group by t.code;
  lookup := staff_lookup_team('team-staff', member_code);
  assert (lookup ->> 'found')::boolean, 'any personal code resolves the team';
  assert lookup ->> 'team_code' = trio_code, 'resolved team code matches';
  assert jsonb_array_length(lookup -> 'members') = 3, 'one lookup returns all three members';

  r := award_team_score('team-staff', trio_code, v_stations[1], 9, false, 'v2-award-1');
  assert (r ->> 'challenge_score')::int = 9, 'team challenge score increments once';
  assert (select count(*) from players p join teams t on t.id = p.team_id
          where t.code = trio_code and p.score = 9) = 3, 'all members receive same station increment';

  r := award_team_score('team-staff', trio_code, v_stations[2], 9, false, 'v2-award-2');
  assert (select count(*) from life_event_instances i join players p on p.id = i.player_id
          join teams t on t.id = p.team_id where t.code = trio_code and i.threshold = 15) = 3,
         'each passport receives its own 15-point event';
  pending := poll_player(member_code) -> 'pending_event';
  assert pending is not null, 'pending event appears on the personal phone';
  assert position('outcomes' in pending::text) = 0, 'hidden outcomes never reach the browser';
  choice_key := pending -> 'choices' -> 0 ->> 'key';

  -- A pending event does not stop the team visiting its next station.
  perform award_team_score('team-staff', trio_code, v_stations[3], 6, false, 'v2-award-3');
  assert (select score from players where code = member_code) = 24,
         'pending player still receives the next team increment';

  event_result := choose_life_event_by_link(v_token, member_code,
    (pending ->> 'id')::uuid, choice_key, 'v2-choice-1');
  assert event_result ->> 'outcome_label' is not null, 'server chooses and returns one outcome';
  assert not (select locked_for_life_event from players where code = member_code), 'choice resolves lock';
  assert (select next_threshold from players where code = member_code) = 35,
         '15-point threshold never moves backwards after random result';
  assert (select count(*) from life_event_instances i join players p on p.id = i.player_id
          where p.code = member_code and i.threshold = 15) = 1,
         'same threshold can only exist once';

  -- Fail once, then a team Second Chance burns one token per active member.
  perform award_team_score('team-staff', trio_code, v_stations[4], 0, true, 'v2-fail');
  perform use_team_token('team-staff', trio_code, 'second_chance', v_stations[4], 'v2-token');
  assert (select count(*) from players p join teams t on t.id = p.team_id
          where t.code = trio_code and not p.token_available) = 3,
         'Trio team help costs all three personal tokens';
  assert (select count(*) from token_usages u join players p on p.id = u.player_id
          join teams t on t.id = p.team_id where t.code = trio_code
          and u.usage_type = 'second_chance') = 3, 'three token audit rows recorded';
  perform award_team_score('team-staff', member_code, v_stations[4], 3, false, 'v2-retry');
  assert exists (select 1 from team_attempts a join teams t on t.id = a.team_id
                 where t.code = trio_code and a.station_id = v_stations[4] and a.status = 'passed'),
         'retry may be scored using any member code';

  -- One submitted idempotency key cannot double-award.
  perform award_team_score('team-staff', trio_code, v_stations[4], 3, false, 'v2-retry');
  assert (select challenge_score from teams where code = trio_code) = 27,
         'idempotent replay keeps one final score';

  raise notice 'PASS 11_team_journey';
end $$;
rollback;

