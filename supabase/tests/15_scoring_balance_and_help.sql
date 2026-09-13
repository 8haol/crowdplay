-- V3.3 regression: free 0..10 scoring, balanced event odds, pre-challenge hint, low-score retries that replace.
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
  v_interview int := (select id from stations where slug = 'interview');
  v_music int := (select id from stations where slug = 'music');
  v_team text; v_hint_team text; v_code text; v_hint_code text;
  v_choice jsonb; v_positive int; v_nonpositive int; r jsonb;
begin
  assert (select scoring_mode from stations where id = v_interview) = 'free', '灵魂拷问 uses free scoring';

  for v_choice in select choice from life_event_scenes s cross join lateral jsonb_array_elements(s.choices) choice where s.active loop
    select
      coalesce(sum((o ->> 'weight')::int) filter (where coalesce((o ->> 'multiplier')::int, 100) > 100
        or (coalesce((o ->> 'multiplier')::int, 100) = 100 and coalesce((o ->> 'delta')::int, 0) > 0)), 0),
      coalesce(sum((o ->> 'weight')::int) filter (where not (coalesce((o ->> 'multiplier')::int, 100) > 100
        or (coalesce((o ->> 'multiplier')::int, 100) = 100 and coalesce((o ->> 'delta')::int, 0) > 0))), 0)
    into v_positive, v_nonpositive from jsonb_array_elements(v_choice -> 'outcomes') o;
    assert v_nonpositive >= v_positive, 'neutral/bad probability must be at least half for choice ' || (v_choice ->> 'key');
  end loop;

  insert into players (event_id, name, code) values (v_ev, '重挑队', '951'), (v_ev, '提示队', '952');
  perform start_game('test-admin', v_ev, '{}'::jsonb);
  select t.code, p.code into v_team, v_code from teams t join players p on p.team_id = t.id where p.name = '重挑队';
  select t.code, p.code into v_hint_team, v_hint_code from teams t join players p on p.team_id = t.id where p.name = '提示队';

  r := use_team_token('STAFF1', v_hint_team, 'hint', null, 'v33-hint');
  assert r ->> 'usage_type' = 'hint', 'pre-challenge hint is accepted';
  assert not (select token_available from players where code = v_hint_code), 'hint consumes the token';

  begin
    perform award_team_score('STAFF1', v_team, v_interview, 11, false, 'v33-bad-score');
    raise exception 'TEST FAILED: expected BAD_TEAM_SCORE';
  exception when others then
    if sqlerrm <> 'BAD_TEAM_SCORE' then raise; end if;
  end;
  perform award_team_score('STAFF1', v_team, v_interview, 4, false, 'v33-first-score');
  assert (select score from players where code = v_code) = 4, 'free score is recorded';

  begin
    perform use_team_token('STAFF1', v_team, 'second_chance', v_music, 'v33-unplayed');
    raise exception 'TEST FAILED: expected TEAM_NOT_ATTEMPTED';
  exception when others then
    if sqlerrm not like 'TEAM_NOT_ATTEMPTED:%' then raise; end if;
  end;

  perform use_team_token('STAFF1', v_team, 'second_chance', v_interview, 'v33-retry-grant');
  perform award_team_score('STAFF1', v_team, v_interview, 8, false, 'v33-retry-score');
  assert (select score from players where code = v_code) = 8, 'retry replaces personal score';
  assert (select challenge_score from teams where code = v_team and event_id = v_ev) = 8, 'retry replaces team score';
  assert exists (select 1 from team_attempts where team_id = (select id from teams where code = v_team and event_id = v_ev) and station_id = v_interview and status = 'superseded' and score = 4),
         'old result remains in the audit trail';

  raise notice 'PASS 15_scoring_balance_and_help';
end $$;
rollback;
