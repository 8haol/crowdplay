-- Tests: end_game / admin_adjust / admin_remove_player / admin_list_players / staff_lookup / key separation
begin;
delete from events; delete from organizations;
insert into organizations (slug, name_zh, name_en, admin_key) values ('tc', '测试教会', 'Test Church', 'test-admin');
insert into events (org_id, title, join_token, staff_code, screen_token, phase, started_at)
select id, '测试场', 'join-t', 'STAFF1', 'screen-t', 'playing', now() from organizations where slug = 'tc';
-- 这场是手工插入的（不经过 admin_create_event），进度助手现在按本场 event_stations
-- 算站点数，所以要像 18_station_library.sql 里 ev_a 那样手动把内置站点铺进本场。
insert into event_stations (event_id, station_id, name_zh, type, scoring_mode, sort_order)
select e.id, s.id, s.name_zh, s.type, s.scoring_mode, s.sort_order
from events e, stations s where e.join_token = 'join-t' and s.org_id is null;

do $$
declare
  v_ev uuid := (select id from events where join_token = 'join-t');
  v_music int := (select id from stations where slug = 'music');
  t1 uuid; t2 uuid; t3 uuid;
  r jsonb;
begin
  t1 := _make_team(v_ev, 'solo', 'solo-1'); t2 := _make_team(v_ev, 'solo', 'solo-2'); t3 := _make_team(v_ev, 'solo', 'solo-3');
  insert into players (event_id, name, code, identity, color_group, team_id, score) values
    (v_ev, '高分', '501', 'solo', 'solo-1', t1, 30),
    (v_ev, '低分', '502', 'solo', 'solo-2', t2, 5),
    (v_ev, '垃圾', '503', 'solo', 'solo-3', t3, 0);
  update players set locked_for_life_event = true, pending_threshold = 15, next_threshold = 35,
                     status_effect = '{"type":"cap_next","value":1}'::jsonb, token_available = false
  where code = '502';

  -- staff code must NOT work for admin functions
  begin
    perform end_game('STAFF1', v_ev);
    raise exception 'TEST FAILED: expected BAD_KEY';
  exception when others then
    if sqlerrm <> 'BAD_KEY' then raise; end if;
  end;

  -- admin_adjust: fix score + unlock + clear effect + restore token in one call
  r := admin_adjust('test-admin', v_ev, '502', p_new_score => 12, p_unlock => true, p_clear_effect => true,
                    p_restore_token => true, p_reason => '现场误录，人工修正');
  assert (r ->> 'score')::int = 12, 'score corrected';
  assert not (r ->> 'locked_for_life_event')::boolean, 'unlocked';
  assert (select status_effect from players where code = '502') is null, 'effect cleared';
  assert (select token_available from players where code = '502'), 'token restored';
  assert (select next_threshold from players where code = '502') = 35, 'untouched fields stay put';
  assert (select count(*) from admin_actions a join players p on p.id = a.player_id
          where p.code = '502' and a.action = 'adjust' and a.reason = '现场误录，人工修正') = 1, 'audit row written';
  assert (select event_id from admin_actions limit 1) = v_ev, 'audit row is stamped with the event';

  perform admin_adjust('test-admin', v_ev, '502', p_new_next_threshold => 0, p_reason => 't');
  assert (select next_threshold from players where code = '502') is null, 'threshold nulled';

  -- remove junk player; staff can no longer resolve them
  perform admin_remove_player('test-admin', v_ev, '503');
  assert (select is_removed from players where code = '503'), 'soft deleted';
  begin
    perform award_team_score('STAFF1', '503', v_music, 6, false, 'a1');
    raise exception 'TEST FAILED: expected TEAM_NOT_FOUND';
  exception when others then
    if sqlerrm <> 'TEAM_NOT_FOUND:503' then raise; end if;
  end;
  assert not exists (select 1 from jsonb_array_elements(board_snapshot('screen-t') -> 'players') p where p ->> 'name' = '垃圾'),
         'removed player absent from the board';

  perform admin_adjust('test-admin', v_ev, '503', p_restore => true, p_reason => '误删恢复');
  assert not (select is_removed from players where code = '503'), 'restored';

  r := admin_list_players('test-admin', v_ev);
  assert jsonb_array_length(r) = 3, 'all players listed';

  -- staff_lookup: mixed found / not found, failed-station targeting info
  perform award_team_score('STAFF1', '501', v_music, 0, true, 'a2');
  r := staff_lookup('STAFF1', array['501', '000']);
  assert (r -> 0 ->> 'found')::boolean, 'first code found';
  assert not (r -> 1 ->> 'found')::boolean, 'unknown code flagged, not an error';
  assert r -> 0 -> 'failed_station_ids' @> to_jsonb(v_music), 'failed station listed as second-chance target';

  -- end_game
  r := end_game('test-admin', v_ev);
  assert (select phase from events where id = v_ev) = 'ended', 'game ended';
  assert not (select join_open from events where id = v_ev), 'ending closes registration';

  -- corrections still work after the game ends
  perform admin_adjust('test-admin', v_ev, '501', p_new_score => 31, p_reason => '赛后补录');
  assert (select score from players where code = '501') = 31, 'post-game correction ok';

  raise notice 'PASS 06_admin';
end $$;
rollback;
