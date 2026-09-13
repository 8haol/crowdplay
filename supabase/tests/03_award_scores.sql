-- Tests: award_team_score — scoring modes, guards, idempotency, phase; _advance_threshold
begin;
delete from events; delete from organizations;
insert into organizations (slug, name_zh, name_en, admin_key) values ('tc', '测试教会', 'Test Church', 'test-admin');
insert into events (org_id, title, join_token, staff_code, screen_token, phase, started_at)
select id, '测试场', 'join-t', 'STAFF1', 'screen-t', 'playing', now() from organizations where slug = 'tc';

-- make one station fixed-mode for this test run (rolled back with the transaction)
update stations set scoring_mode = 'fixed' where slug = 'ring-toss';

-- 这场是手工插入的（不经过 admin_create_event），进度助手现在按本场 event_stations
-- 算站点数，所以要像 18_station_library.sql 里 ev_a 那样手动把内置站点铺进本场。
insert into event_stations (event_id, station_id, name_zh, type, scoring_mode, sort_order)
select e.id, s.id, s.name_zh, s.type, s.scoring_mode, s.sort_order
from events e, stations s where e.join_token = 'join-t' and s.org_id is null;

do $$
declare
  v_ev uuid := (select id from events where join_token = 'join-t');
  v_music int := (select id from stations where slug = 'music');
  v_uk    int := (select id from stations where slug = 'uk-life');
  v_intv  int := (select id from stations where slug = 'interview');
  v_ring  int := (select id from stations where slug = 'ring-toss');
  v_grace int := (select id from stations where slug = 'grace');
  t1 uuid; t2 uuid;
  r jsonb;
begin
  -- threshold helper sanity
  assert _advance_threshold(21, 15) = 35,  'crossed 15 -> next 35';
  assert _advance_threshold(43, 35) = 45,  'crossed 35 -> next 45';
  assert _advance_threshold(50, 35) is null, 'double-cross 35+45 -> null';
  assert _advance_threshold(99, null) is null, 'null stays null';

  t1 := _make_team(v_ev, 'solo', 'solo-1');
  t2 := _make_team(v_ev, 'solo', 'solo-2');
  insert into players (event_id, name, code, identity, color_group, team_id) values
    (v_ev, '甲', '101', 'solo', 'solo-1', t1), (v_ev, '乙', '102', 'solo', 'solo-2', t2);

  -- bad staff code
  begin
    perform award_team_score('NOPE99', '101', v_music, 6, false, 'k0');
    raise exception 'TEST FAILED: expected BAD_STAFF_KEY';
  exception when others then
    if sqlerrm <> 'BAD_STAFF_KEY' then raise; end if;
  end;

  -- basic graded award
  r := award_team_score('STAFF1', '101', v_music, 6, false, 'k1');
  assert (r ->> 'awarded')::int = 6 and r ->> 'status' = 'passed', 'score 6 recorded';
  assert (select score from players where code = '101') = 6, 'player score updated';
  assert (select event_id from team_attempts where team_id = t1) = v_ev, 'team attempt is stamped with the event';

  -- graded rejects non-3/6/9
  begin
    perform award_team_score('STAFF1', '101', v_uk, 5, false, 'k2');
    raise exception 'TEST FAILED: expected BAD_TEAM_SCORE';
  exception when others then
    if sqlerrm <> 'BAD_TEAM_SCORE' then raise; end if;
  end;

  -- fixed: only 6
  begin
    perform award_team_score('STAFF1', '101', v_ring, 9, false, 'k3');
    raise exception 'TEST FAILED: expected BAD_TEAM_SCORE';
  exception when others then
    if sqlerrm <> 'BAD_TEAM_SCORE' then raise; end if;
  end;
  perform award_team_score('STAFF1', '101', v_ring, 6, false, 'k4');
  assert (select score from players where code = '101') = 12, 'fixed station adds 6';

  -- free: 0..10
  perform award_team_score('STAFF1', '102', v_intv, 0, false, 'k5');
  assert (select score from players where code = '102') = 0, 'free score 0 is valid';
  begin
    perform award_team_score('STAFF1', '101', v_intv, 11, false, 'k6');
    raise exception 'TEST FAILED: expected BAD_TEAM_SCORE';
  exception when others then
    if sqlerrm <> 'BAD_TEAM_SCORE' then raise; end if;
  end;

  -- non-main station rejected
  begin
    perform award_team_score('STAFF1', '101', v_grace, 6, false, 'k7');
    raise exception 'TEST FAILED: expected BAD_STATION';
  exception when others then
    if sqlerrm <> 'BAD_STATION' then raise; end if;
  end;

  -- same station twice rejected
  begin
    perform award_team_score('STAFF1', '101', v_music, 3, false, 'k8');
    raise exception 'TEST FAILED: expected TEAM_ALREADY_ATTEMPTED';
  exception when others then
    if sqlerrm not like 'TEAM_ALREADY_ATTEMPTED:%' then raise; end if;
  end;

  -- idempotency: same key returns stored result, no double-scoring
  r := award_team_score('STAFF1', '101', v_music, 6, false, 'k1');
  assert (r ->> 'awarded')::int = 6, 'replay returns original result';
  assert (select score from players where code = '101') = 12, 'replay does not re-score';

  -- failure scores 0 and is recorded
  r := award_team_score('STAFF1', '102', v_uk, 0, true, 'k9');
  assert r ->> 'status' = 'failed' and (r ->> 'awarded')::int = 0, 'failed attempt';
  assert (select status from attempts a join players p on p.id = a.player_id where p.code = '102' and a.station_id = v_uk) = 'failed', 'failed attempt row';

  -- unknown team
  begin
    perform award_team_score('STAFF1', '999', v_intv, 6, false, 'k10');
    raise exception 'TEST FAILED: expected TEAM_NOT_FOUND';
  exception when others then
    if sqlerrm <> 'TEAM_NOT_FOUND:999' then raise; end if;
  end;

  -- wrong phase
  update events set phase = 'ended' where id = v_ev;
  begin
    perform award_team_score('STAFF1', '102', v_music, 6, false, 'k11');
    raise exception 'TEST FAILED: expected GAME_NOT_PLAYING';
  exception when others then
    if sqlerrm <> 'GAME_NOT_PLAYING' then raise; end if;
  end;

  raise notice 'PASS 03_award_scores';
end $$;
rollback;
