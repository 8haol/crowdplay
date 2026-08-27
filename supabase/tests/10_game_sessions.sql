-- Tests: QR admission, session archive, and admin-created new games.
begin;
delete from game_archives;
delete from rpc_results; delete from admin_actions; delete from token_usages;
delete from life_events; delete from life_event_instances; delete from attempts;
delete from team_attempts; delete from players; delete from teams;
update app_config set value = 'session-admin' where key = 'admin_key';
update game_state set
  event_id = gen_random_uuid(),
  title = '第一场',
  join_token = 'old-session-token',
  join_passphrase = 'unused',
  join_open = true,
  phase = 'waiting',
  created_at = now(),
  started_at = null,
  ended_at = null
where id = 1;

do $$
declare
  r jsonb;
  old_event uuid := (select event_id from game_state where id = 1);
  new_token text;
begin
  r := game_landing('old-session-token');
  assert (r ->> 'is_current')::boolean, 'current QR resolves';
  assert r ->> 'title' = '第一场', 'current title returned';

  r := join_by_link('扫码玩家', 'old-session-token');
  assert r ->> 'code' ~ '^[1-9]\d{2}$', 'QR join creates a three-digit player code';
  assert (select count(*) from players) = 1, 'player stored in current session';

  begin
    perform join_by_link('错误链接', 'not-a-token');
    raise exception 'TEST FAILED: expected BAD_GAME_LINK';
  exception when others then
    if sqlerrm <> 'BAD_GAME_LINK' then raise; end if;
  end;

  perform end_game('session-admin');
  assert not (select join_open from game_state where id = 1), 'ending closes registration';

  r := admin_create_game('session-admin', '第二场', false);
  new_token := r ->> 'join_token';
  assert r ->> 'title' = '第二场', 'new session created';
  assert new_token is distinct from 'old-session-token', 'new QR token generated';
  assert (select count(*) from players) = 0, 'live roster reset';
  assert exists (select 1 from game_archives where source_event_id = old_event), 'old session archived';

  r := game_landing('old-session-token');
  assert not (r ->> 'is_current')::boolean, 'old QR is archived';
  assert r ->> 'current_join_token' = new_token, 'archive can point to current session';

  r := admin_console('session-admin');
  assert r -> 'current' ->> 'title' = '第二场', 'console returns current session';
  assert jsonb_array_length(r -> 'archives') = 1, 'console returns archive list';
  assert jsonb_array_length(r -> 'station_metrics') = 9, 'console returns every station';

  r := admin_event_detail('session-admin', old_event);
  assert not (r ->> 'is_current')::boolean, 'archived event detail is marked historical';
  assert jsonb_array_length(r -> 'players') = 1, 'archive preserves player detail';

  r := admin_update_station('session-admin', (select id from stations where slug = 'music'), '音乐测试站', 'fixed');
  assert r ->> 'name_zh' = '音乐测试站', 'admin can rename a station';
  assert r ->> 'scoring_mode' = 'fixed', 'admin can change scoring mode while waiting';

  r := admin_update_access('session-admin', 'new-staff-key', null);
  assert (r ->> 'staff_key_changed')::boolean, 'staff access key can be changed in console';
  perform _require_key('staff', 'new-staff-key');

  begin
    perform join_by_link('旧链接玩家', 'old-session-token');
    raise exception 'TEST FAILED: expected GAME_ARCHIVED';
  exception when others then
    if sqlerrm <> 'GAME_ARCHIVED' then raise; end if;
  end;

  raise notice 'PASS 10_game_sessions';
end $$;
rollback;
