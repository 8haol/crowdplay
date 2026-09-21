-- Tests: hidden station (secret NPC) — excluded from every main-station count, surfaced via full_moon
begin;
delete from events; delete from organizations;
insert into organizations (slug, name_zh, name_en, admin_key) values ('tc', '测试教会', 'Test Church', 'test-admin');

do $$
declare
  r jsonb; ev uuid; jt text; sc text; st text; secret_id int; v_code text; team uuid;
  mains int[]; i int; total int; before int; feed jsonb;
begin
  r := admin_create_event('test-admin', '彩蛋场');
  ev := (r ->> 'event_id')::uuid; jt := r ->> 'join_token'; sc := r ->> 'staff_code'; st := r ->> 'screen_token';
  total := _main_station_total(ev);
  assert total = 7, 'fixture: seven visible mains';

  -- a hidden station in the library: main + fixed forced, hint kept
  r := admin_library_create('test-admin', '神秘嘉宾', 'main', null, true, ' 场地里有一位系着红丝带的人。 ');
  secret_id := (r ->> 'id')::int;
  assert (r ->> 'hidden')::boolean and r ->> 'scoring_mode' = 'fixed' and r ->> 'type' = 'main', 'hidden station is main + fixed: ' || r::text;
  assert r ->> 'hint' = '场地里有一位系着红丝带的人。', 'hint trimmed and stored';
  begin
    perform admin_library_create('test-admin', '藏不了', 'grace', null, true, 'x');
    raise exception 'TEST FAILED: expected BAD_STATION_TYPE';
  exception when others then if sqlerrm <> 'BAD_STATION_TYPE' then raise; end if; end;
  -- update keeps hidden when p_hidden is null; unhiding clears the hint
  r := admin_library_update('test-admin', secret_id, '神秘嘉宾', 'graded', null);
  assert (r ->> 'hidden')::boolean and r ->> 'scoring_mode' = 'fixed' and r ->> 'hint' is not null, 'update without p_hidden keeps hidden + fixed';
  r := admin_library_update('test-admin', secret_id, '神秘嘉宾', 'graded', null, false, null);
  assert not (r ->> 'hidden')::boolean and r ->> 'scoring_mode' = 'graded' and r ->> 'hint' is null, 'unhiding clears hint and takes the given mode';
  r := admin_library_update('test-admin', secret_id, '神秘嘉宾', null, null, true, '场地里有一位系着红丝带的人。');
  assert (r ->> 'hidden')::boolean and r ->> 'scoring_mode' = 'fixed', 're-hiding forces fixed';

  -- add it to this event: snapshot carries hidden + hint, totals unchanged
  perform admin_set_event_stations('test-admin', ev,
    (select jsonb_agg(jsonb_build_object('station_id', es.station_id, 'name_zh', es.name_zh,
                                         'scoring_mode', es.scoring_mode, 'sort_order', es.sort_order))
     from event_stations es where es.event_id = ev)
    || jsonb_build_array(jsonb_build_object('station_id', secret_id, 'name_zh', '神秘嘉宾', 'sort_order', 99)));
  assert (select hidden from event_stations where event_id = ev and station_id = secret_id), 'snapshot carries hidden';
  assert (select hint from event_stations where event_id = ev and station_id = secret_id) = '场地里有一位系着红丝带的人。', 'snapshot carries hint';
  assert (select scoring_mode from event_stations where event_id = ev and station_id = secret_id) = 'fixed', 'snapshot forces fixed';
  assert _main_station_total(ev) = total, 'hidden station does not count toward the total';
  assert (board_snapshot(st) ->> 'stations_total')::int = total, 'board total excludes it';

  -- staff sees it flagged; the player card does not list it
  r := staff_stations(sc);
  assert exists (select 1 from jsonb_array_elements(r) s where (s ->> 'station_id')::int = secret_id and (s ->> 'hidden')::boolean), 'staff sees hidden station';
  assert (select count(*) from jsonb_array_elements(r) s where not (s ->> 'hidden')::boolean) = 9, 'other stations are not hidden';

  -- a solo player walks the mains
  r := join_by_link('甲', jt);
  v_code := r ->> 'code';
  perform start_game('test-admin', ev, '{}'::jsonb);
  team := (select team_id from players where event_id = ev and code = v_code);
  r := poll_player_by_link(jt, v_code);
  assert not exists (select 1 from jsonb_array_elements(r -> 'stations') s where (s ->> 'station_id')::int = secret_id), 'player stations list hides it';
  assert jsonb_array_length(r -> 'stations') = 9, 'player sees the nine visible stations';
  assert (r -> 'player' ->> 'stations_total')::int = total, 'player total excludes it';
  assert not (r -> 'full_moon' ->> 'reached')::boolean and r -> 'full_moon' ->> 'hint' is null and not (r -> 'full_moon' ->> 'secret_done')::boolean, 'full moon starts dark: ' || (r -> 'full_moon')::text;

  mains := (select array_agg(station_id order by sort_order) from event_stations where event_id = ev and type = 'main' and not hidden);
  for i in 1..array_length(mains, 1) - 1 loop perform award_team_score(sc, v_code, mains[i], 6, false, 'm' || i); end loop;
  update players set locked_for_life_event = false, pending_threshold = null where event_id = ev;
  update life_event_instances set state = 'cancelled' where event_id = ev and state = 'pending';
  r := poll_player_by_link(jt, v_code);
  assert not (r -> 'full_moon' ->> 'reached')::boolean, 'not reached before the last main';
  assert r -> 'full_moon' ->> 'hint' is null, 'no hint before reached';
  assert (r -> 'player' ->> 'stations_done')::int = total - 1, 'six of seven';

  perform award_team_score(sc, v_code, mains[array_length(mains, 1)], 6, false, 'mlast');
  update players set locked_for_life_event = false, pending_threshold = null where event_id = ev;
  update life_event_instances set state = 'cancelled' where event_id = ev and state = 'pending';
  r := poll_player_by_link(jt, v_code);
  assert (r -> 'full_moon' ->> 'reached')::boolean, 'reached after all mains';
  assert r -> 'full_moon' ->> 'hint' = '场地里有一位系着红丝带的人。', 'hint shown';
  assert not (r -> 'full_moon' ->> 'secret_done')::boolean, 'secret not done yet';
  assert (r -> 'player' ->> 'stations_done')::int = total, 'seven of seven';

  -- NPC stamps the secret with an ordinary staff code
  before := (select score from players where event_id = ev and code = v_code);
  begin
    perform award_team_score(sc, v_code, secret_id, 9, false, 'npc-bad');
    raise exception 'TEST FAILED: expected BAD_TEAM_SCORE';
  exception when others then if sqlerrm <> 'BAD_TEAM_SCORE' then raise; end if; end;
  perform award_team_score(sc, v_code, secret_id, 6, false, 'npc');
  assert (select score from players where event_id = ev and code = v_code) = before + 6, 'secret adds 6 to the player score';
  r := poll_player_by_link(jt, v_code);
  assert (r -> 'full_moon' ->> 'secret_done')::boolean, 'secret done';
  assert (r -> 'full_moon' ->> 'reached')::boolean, 'still reached';
  assert (r -> 'player' ->> 'stations_done')::int = total, 'stations_done does not grow past the total';
  assert exists (select 1 from jsonb_array_elements(r -> 'attempts') a where (a ->> 'station_id')::int = secret_id and a ->> 'status' = 'passed'), 'the secret attempt is still in the attempt list for the extra stamp';

  -- counting sites all exclude it
  assert (select st_done from _award_stats(ev) where name = '甲') = total, 'st_done excludes the secret';
  assert (select st_total from _award_stats(ev) where name = '甲') = total * 6, 'st_total excludes the secret';
  assert (select stations_done from _team_stats(ev) where team_id = team) = total, 'team stations_done excludes the secret';
  assert (select station_score from _team_stats(ev) where team_id = team) = total * 6, 'team station_score excludes the secret';
  assert (select _main_stations_done(ev, id) from players where event_id = ev and code = v_code) = total, '_main_stations_done excludes the secret';
  assert exists (select 1 from jsonb_array_elements(board_snapshot(st) -> 'players') p where p ->> 'name' = '甲' and (p ->> 'stations_done')::int = total), 'board progress excludes the secret';

  -- board feed teases without naming the station
  feed := board_snapshot(st) -> 'feed';
  assert exists (select 1 from jsonb_array_elements(feed) f where f ->> 'kind' = 'attempt' and (f ->> 'secret')::boolean and f -> 'station' = 'null'::jsonb and (f ->> 'score')::int = 6), 'feed teases without naming the station: ' || feed::text;
  assert (select count(*) from jsonb_array_elements(feed) f where f ->> 'kind' = 'attempt' and not (f ->> 'secret')::boolean and f ->> 'station' is not null) = total, 'ordinary attempts keep their station name';
  assert position('神秘嘉宾' in feed::text) = 0, 'the station name never reaches the board';

  -- new events copy hidden + hint from the previous roster
  perform end_game('test-admin', ev);
  r := admin_create_event('test-admin', '下一场');
  assert (select hidden from event_stations where event_id = (r ->> 'event_id')::uuid and station_id = secret_id), 'seed copies hidden';
  assert (select hint from event_stations where event_id = (r ->> 'event_id')::uuid and station_id = secret_id) is not null, 'seed copies hint';
  assert _main_station_total((r ->> 'event_id')::uuid) = total, 'next event total also excludes it';

  raise notice 'PASS 23_secret_station';
end $$;
rollback;
