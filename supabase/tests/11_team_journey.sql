-- V2 regression: one team result, non-blocking private events, hidden randomized outcomes, all-member token cost.
begin;
delete from events; delete from organizations;
insert into organizations (slug, name_zh, name_en, admin_key) values ('tc', '测试教会', 'Test Church', 'test-admin');
insert into events (org_id, title, join_token, staff_code, screen_token, phase, started_at)
select id, '测试场', 'join-t', 'STAFF1', 'screen-t', 'waiting', null from organizations where slug = 'tc';
-- 这场是手工插入的（不经过 admin_create_event），进度助手现在按本场 event_stations
-- 算站点数，所以要像 18_station_library.sql 里 ev_a 那样手动把内置站点铺进本场。
insert into event_stations (event_id, station_id, name_zh, type, scoring_mode, sort_order)
select e.id, s.id, s.name_zh, s.type, s.scoring_mode, s.sort_order
from events e, stations s where e.join_token = 'join-t' and s.org_id is null;

do $$
declare
  v_ev uuid := (select id from events where join_token = 'join-t');
  v_stations int[] := (select array_agg(id order by sort_order) from stations where type = 'main');
  r jsonb; lookup jsonb; pending jsonb; event_result jsonb;
  trio_code text; member_code text; choice_key text; card_code text;
begin
  insert into players (event_id, name, code) values
    (v_ev, '甲', '811'), (v_ev, '乙', '812'), (v_ev, '丙', '813'), (v_ev, '丁', '815'), (v_ev, '戊', '816'), (v_ev, '己', '817');

  r := start_game('test-admin', v_ev, '{"trio":1,"duo":1}'::jsonb);
  assert (r ->> 'total_teams')::int = 3, 'trio + duo + solo = 3 teams';

  select t.code, min(p.code) into trio_code, member_code
  from teams t join players p on p.team_id = t.id where t.identity = 'trio' group by t.code;
  lookup := staff_lookup_team('STAFF1', member_code);
  assert (lookup ->> 'found')::boolean and lookup ->> 'team_code' = trio_code, 'any personal code resolves the team';
  assert jsonb_array_length(lookup -> 'members') = 3, 'one lookup returns all three members';
  assert lookup ->> 'event_title' = '测试场', 'lookup tells staff which event they are in';

  r := award_team_score('STAFF1', trio_code, v_stations[1], 9, false, 'v2-award-1');
  assert (r ->> 'challenge_score')::int = 9, 'team challenge score increments once';
  assert (select count(*) from players p join teams t on t.id = p.team_id where t.code = trio_code and p.score = 9) = 3, 'all members receive same increment';
  assert (select count(*) from life_event_instances i join players p on p.id = i.player_id join teams t on t.id = p.team_id where t.code = trio_code) = 0,
         'nine points and one station opens neither gate';

  -- 18 points clears the 15-point gate two stations early
  perform award_team_score('STAFF1', trio_code, v_stations[2], 9, false, 'v2-award-2');
  assert (select count(*) from life_event_instances i join players p on p.id = i.player_id join teams t on t.id = p.team_id where t.code = trio_code and i.stage = 1) = 3,
         'the 15-point gate fires before the third station';
  pending := poll_player_by_link('join-t', member_code) -> 'pending_event';
  assert pending is not null and (pending ->> 'stage')::int = 1, 'pending event appears on the phone with its stage';
  assert position('outcomes' in pending::text) = 0, 'hidden outcomes never reach the browser';
  choice_key := pending -> 'choices' -> 0 ->> 'key';

  -- a pending event does not stop the team visiting its next stations
  perform award_team_score('STAFF1', trio_code, v_stations[3], 6, false, 'v2-award-3');
  perform award_team_score('STAFF1', trio_code, v_stations[5], 6, false, 'v2-award-5');
  assert (select score from players where code = member_code) = 30, 'pending player still receives increments';

  event_result := choose_life_event_by_link('join-t', member_code, (pending ->> 'id')::uuid, choice_key, 'v2-choice-1');
  assert event_result ->> 'outcome_label' is not null and (event_result ->> 'stage')::int = 1, 'server chooses one outcome';
  assert (select count(*) from life_event_instances i join players p on p.id = i.player_id where p.code = member_code and i.stage = 1) = 1, 'the same stage exists once';

  perform award_team_score('STAFF1', trio_code, v_stations[6], 6, false, 'v2-award-6');
  assert (select locked_for_life_event from players where code = member_code), 'the stage earned by either gate is not lost';
  assert (select stage from life_event_instances i join players p on p.id = i.player_id where p.code = member_code and i.state = 'pending') = 2, 'stage 2 follows';
  pending := poll_player_by_link('join-t', member_code) -> 'pending_event';
  perform choose_life_event_by_link('join-t', member_code, (pending ->> 'id')::uuid, pending -> 'choices' -> 0 ->> 'key', 'v2-choice-2');
  assert (select count(*) from life_event_instances i join players p on p.id = i.player_id where p.code = member_code and i.stage in (1, 2) and i.state = 'resolved') = 2,
         'the first two stages are on the record';

  -- teammates by name, no team code on the passport
  r := poll_player_by_link('join-t', member_code) -> 'player';
  assert jsonb_array_length(r -> 'teammates') = 2 and not (r ? 'team_code'), 'a Trio passport lists two teammates and no code';

  -- fail once, team Second Chance burns one token per member, grant mirrored to passports
  perform award_team_score('STAFF1', trio_code, v_stations[4], 0, true, 'v2-fail');
  perform use_team_token('STAFF1', trio_code, 'second_chance', v_stations[4], 'v2-token');
  assert (select count(*) from players p join teams t on t.id = p.team_id where t.code = trio_code and not p.token_available) = 3, 'Trio help costs all three tokens';
  assert (select count(*) from attempts a join players p on p.id = a.player_id join teams t on t.id = p.team_id
          where t.code = trio_code and a.station_id = v_stations[4] and a.status = 'retry_granted') = 3, 'personal passports show the pending retry';
  perform award_team_score('STAFF1', member_code, v_stations[4], 3, false, 'v2-retry');
  assert exists (select 1 from team_attempts a join teams t on t.id = a.team_id where t.code = trio_code and a.station_id = v_stations[4] and a.status = 'passed'),
         'retry may be scored using any member code';
  perform award_team_score('STAFF1', trio_code, v_stations[4], 3, false, 'v2-retry');
  assert (select challenge_score from teams where code = trio_code and event_id = v_ev) = 39, 'idempotent replay keeps one final score';

  -- keepsake cards do not wait for the closing ceremony
  select code into card_code from players where token_available and not is_removed limit 1;
  perform redeem_token_card('STAFF1', card_code, 'v2-card-live');
  assert not (select token_available from players where code = card_code), 'an unspent token may be swapped for a card mid-event';

  raise notice 'PASS 11_team_journey';
end $$;
rollback;
