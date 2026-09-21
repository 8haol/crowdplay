-- Tests: admin_set_attempt / admin_player_attempts — per-station score edits move the total by the delta
begin;
delete from events; delete from organizations;
insert into organizations (slug, name_zh, name_en, admin_key) values ('tc', '测试教会', 'Test Church', 'test-admin');
insert into events (org_id, title, join_token, staff_code, screen_token, phase, started_at)
select id, '测试场', 'join-t', 'STAFF1', 'screen-t', 'playing', now() from organizations where slug = 'tc';
insert into event_stations (event_id, station_id, name_zh, type, scoring_mode, sort_order)
select e.id, s.id, s.name_zh, s.type, s.scoring_mode, s.sort_order from events e, stations s where e.join_token = 'join-t' and s.org_id is null;

do $$
declare
  v_ev uuid := (select id from events where join_token = 'join-t');
  v_music int := (select id from stations where slug = 'music');
  v_free int := (select id from stations where org_id is null and scoring_mode = 'free' limit 1);
  v_life int := (select id from stations where slug = 'life-event');
  p1 uuid; t uuid; r jsonb; before int;
begin
  t := _make_team(v_ev, 'duo', 'blue');
  insert into players (event_id, name, code, identity, color_group, team_id) values
    (v_ev, '甲', '901', 'duo', 'blue', t), (v_ev, '乙', '902', 'duo', 'blue', t);
  p1 := (select id from players where code = '901');
  perform award_team_score('STAFF1', '901', v_music, 9, false, 'e1');
  before := (select score from players where code = '901');
  assert before = 9, 'fixture: music gave 9';

  -- change one station for one player: total moves by the delta only
  r := admin_set_attempt('test-admin', v_ev, '901', v_music, 6, 'passed', false, '看错了');
  assert (r ->> 'score')::int = before - 3, 'score moved by -3, got ' || (r ->> 'score');
  assert (select score from attempts a where a.player_id = p1 and a.station_id = v_music and a.status in ('passed','failed')) = 6, 'attempt row updated';
  assert (select scored_by from attempts a where a.player_id = p1 and a.station_id = v_music and a.status in ('passed','failed')) = 'admin', 'attempt marked as admin-scored';
  assert (select score from players where code = '902') = before, 'teammate untouched when whole_team=false';
  assert (select challenge_score from teams where id = t) = 9, 'team score untouched when whole_team=false';
  assert (select st_total from _award_stats(v_ev) where name = '甲') = 6, 'award stats follow the attempt';

  -- whole team
  r := admin_set_attempt('test-admin', v_ev, '901', v_music, 3, 'passed', true, '整队');
  assert (r ->> 'score')::int = 3, 'own score follows';
  assert (select score from players where code = '902') = before - 6, 'teammate follows when whole_team=true';
  assert (select score from team_attempts ta where ta.team_id = t and ta.station_id = v_music and ta.status in ('passed','failed')) = 3, 'team attempt synced';
  assert (select challenge_score from teams where id = t) = 3, 'team challenge score follows the delta';

  -- station never played → row inserted
  r := admin_set_attempt('test-admin', v_ev, '901', v_free, 7, 'passed', false, null);
  assert (select count(*) from attempts a where a.player_id = p1 and a.station_id = v_free) = 1, 'attempt inserted';
  assert (r ->> 'score')::int = 10, 'inserted attempt adds its score, got ' || (r ->> 'score');

  -- failed → score 0 regardless of p_score
  r := admin_set_attempt('test-admin', v_ev, '901', v_free, 7, 'failed', false, null);
  assert (r ->> 'score')::int = 3, 'failing a station takes its points back, got ' || (r ->> 'score');
  assert (select status from attempts a where a.player_id = p1 and a.station_id = v_free and a.status in ('passed','failed')) = 'failed', 'status updated';

  -- out of range
  begin
    perform admin_set_attempt('test-admin', v_ev, '901', v_music, 5, 'passed', false, null); -- graded allows 3/6/9
    raise exception 'TEST FAILED: expected BAD_SCORE';
  exception when others then if sqlerrm <> 'BAD_SCORE' then raise; end if; end;
  begin
    perform admin_set_attempt('test-admin', v_ev, '901', v_free, 11, 'passed', false, null);
    raise exception 'TEST FAILED: expected BAD_SCORE';
  exception when others then if sqlerrm <> 'BAD_SCORE' then raise; end if; end;

  -- not a main station / unknown player / bad status
  begin
    perform admin_set_attempt('test-admin', v_ev, '901', v_life, 6, 'passed', false, null);
    raise exception 'TEST FAILED: expected BAD_STATION';
  exception when others then if sqlerrm <> 'BAD_STATION' then raise; end if; end;
  begin
    perform admin_set_attempt('test-admin', v_ev, '999', v_music, 6, 'passed', false, null);
    raise exception 'TEST FAILED: expected PLAYER_NOT_FOUND';
  exception when others then if sqlerrm not like 'PLAYER_NOT_FOUND%' then raise; end if; end;
  begin
    perform admin_set_attempt('test-admin', v_ev, '901', v_music, 6, 'superseded', false, null);
    raise exception 'TEST FAILED: expected BAD_STATUS';
  exception when others then if sqlerrm <> 'BAD_STATUS' then raise; end if; end;

  -- wrong org key
  begin
    perform admin_set_attempt('nope', v_ev, '901', v_music, 6, 'passed', false, null);
    raise exception 'TEST FAILED: expected auth error';
  exception when others then if sqlerrm not like 'BAD_KEY%' and sqlerrm not like 'BAD_ADMIN_KEY%' and sqlerrm not like 'FORBIDDEN%' then raise; end if; end;

  -- audit: four successful edits
  assert (select count(*) from admin_actions where action = 'set_attempt') = 4, 'four audit rows';
  assert (select detail -> 'before_attempt' ->> 'score' from admin_actions where action = 'set_attempt' order by id limit 1) = '9', 'audit carries the old attempt';

  r := admin_player_attempts('test-admin', v_ev, '901');
  assert jsonb_array_length(r) = 7, 'one row per main station, got ' || jsonb_array_length(r)::text;
  assert exists (select 1 from jsonb_array_elements(r) x where (x ->> 'station_id')::int = v_music and (x ->> 'score')::int = 3 and x ->> 'status' = 'passed'), 'current score shown';
  assert exists (select 1 from jsonb_array_elements(r) x where (x ->> 'station_id')::int = v_free and x ->> 'status' = 'failed'), 'failed status shown';
  assert (select count(*) from jsonb_array_elements(r) x where x -> 'score' = 'null'::jsonb) = 5, 'unplayed stations carry null score';
  assert exists (select 1 from jsonb_array_elements(r) x where x ->> 'scoring_mode' = 'graded' and x ->> 'name_zh' is not null), 'rows carry mode and name';

  -- anon may call both (admin console runs on the anon key)
  set local role anon;
  r := admin_player_attempts('test-admin', v_ev, '901');
  assert jsonb_array_length(r) = 7, 'anon can read attempts';
  reset role;
  raise notice 'PASS 22_admin_set_attempt';
end $$;
rollback;
