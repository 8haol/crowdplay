-- Tests: end_game / admin_adjust / admin_remove_player / admin_list_players /
-- leaderboard / staff_lookup / key separation
begin;
delete from rpc_results; delete from admin_actions; delete from token_usages;
delete from life_events; delete from attempts; delete from players;
update app_config set value = 'test-admin' where key = 'admin_key';
update app_config set value = 'test-staff' where key = 'staff_key';
update game_state set phase = 'playing', join_passphrase = 'pass', started_at = now() where id = 1;

do $$
declare
  v_music int := (select id from stations where slug = 'music');
  r jsonb;
begin
  insert into players (name, code, identity, score) values
    ('高分', '5001', 'solo', 30),
    ('低分', '5002', 'solo', 5),
    ('垃圾', '5003', null, 0);
  update players set locked_for_life_event = true, pending_threshold = 15,
                     next_threshold = 35,
                     status_effect = '{"type":"cap_next","value":1}'::jsonb,
                     token_available = false
  where code = '5002';

  -- staff key must NOT work for admin functions
  begin
    perform end_game('test-staff');
    raise exception 'TEST FAILED: expected BAD_KEY';
  exception when others then
    if sqlerrm <> 'BAD_KEY' then raise; end if;
  end;

  -- admin_adjust: fix score + unlock + clear effect + restore token in one call
  r := admin_adjust('test-admin', '5002',
                    p_new_score => 12, p_unlock => true, p_clear_effect => true,
                    p_restore_token => true, p_reason => '现场误录，人工修正');
  assert (r ->> 'score')::int = 12, 'score corrected';
  assert not (r ->> 'locked_for_life_event')::boolean, 'unlocked';
  assert (select status_effect from players where code = '5002') is null, 'effect cleared';
  assert (select token_available from players where code = '5002'), 'token restored';
  assert (select pending_threshold from players where code = '5002') is null, 'pending cleared';
  assert (select next_threshold from players where code = '5002') = 35,
         'untouched fields stay put';
  assert (select count(*) from admin_actions a join players p on p.id = a.player_id
          where p.code = '5002' and a.action = 'adjust'
            and a.reason = '现场误录，人工修正') = 1, 'audit row written';

  -- admin_adjust: set next_threshold explicitly (0 sentinel = null)
  perform admin_adjust('test-admin', '5002', p_new_next_threshold => 0, p_reason => 't');
  assert (select next_threshold from players where code = '5002') is null, 'threshold nulled';
  perform admin_adjust('test-admin', '5002', p_new_next_threshold => 45, p_reason => 't');
  assert (select next_threshold from players where code = '5002') = 45, 'threshold set';

  -- remove junk player; scoring them now fails; leaderboard hides them
  perform admin_remove_player('test-admin', '5003');
  assert (select is_removed from players where code = '5003'), 'soft deleted';
  begin
    perform award_scores('test-staff', '[{"code":"5003","score":6}]'::jsonb, v_music, 'a1');
    raise exception 'TEST FAILED: expected PLAYER_NOT_FOUND';
  exception when others then
    if sqlerrm <> 'PLAYER_NOT_FOUND:5003' then raise; end if;
  end;
  assert not exists (select 1 from leaderboard where code = '5003'),
         'removed player absent from leaderboard';
  assert (select code from leaderboard limit 1) = '5001',
         'leaderboard ordered by score desc';

  -- restore via admin_adjust
  perform admin_adjust('test-admin', '5003', p_restore => true, p_reason => '误删恢复');
  assert not (select is_removed from players where code = '5003'), 'restored';

  -- admin_list_players includes everyone + attempt counts
  r := admin_list_players('test-admin');
  assert jsonb_array_length(r) = 3, 'all players listed';

  -- staff_lookup: mixed found / not found, failed-station targeting info
  perform award_scores('test-staff', '[{"code":"5001","failed":true}]'::jsonb, v_music, 'a2');
  r := staff_lookup('test-staff', array['5001', '0000']);
  assert (r -> 0 ->> 'found')::boolean, 'first code found';
  assert not (r -> 1 ->> 'found')::boolean, 'unknown code flagged, not an error';
  assert r -> 0 -> 'failed_station_ids' @> to_jsonb(v_music),
         'failed station listed as second-chance target';

  -- end_game
  r := end_game('test-admin');
  assert (select phase from game_state where id = 1) = 'ended', 'game ended';

  -- admin_adjust still works after the game ends (post-event corrections)
  perform admin_adjust('test-admin', '5001', p_new_score => 31, p_reason => '赛后补录');
  assert (select score from players where code = '5001') = 31, 'post-game correction ok';

  raise notice 'PASS 06_admin';
end $$;
rollback;
