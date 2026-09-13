-- Tests: event lifecycle — landing, ending, creating the next event without wiping the last.
begin;
delete from events; delete from organizations;
insert into organizations (slug, name_zh, name_en, admin_key) values ('tc', '测试教会', 'Test Church', 'test-admin');
insert into events (org_id, title, join_token, staff_code, screen_token, phase, started_at)
select id, '测试场', 'old-token', 'STAFF1', 'screen-t', 'waiting', null from organizations where slug = 'tc';

do $$
declare
  old_ev uuid := (select id from events where join_token = 'old-token');
  new_ev uuid;
  new_token text;
  r jsonb;
begin
  r := game_landing('old-token');
  assert (r ->> 'is_current')::boolean and r ->> 'title' = '测试场', 'QR resolves to its event';
  assert r -> 'org' ->> 'slug' = 'tc', 'landing carries the organisation';
  assert position('staff_code' in r::text) = 0, 'landing leaks no keys';

  r := join_by_link('扫码玩家', 'old-token');
  assert r ->> 'code' ~ '^[1-9]\d{2}$', 'QR join creates a three-digit player code';
  assert (select count(*) from players where event_id = old_ev) = 1, 'player stored in that event';

  r := game_landing('not-a-token');
  assert (r ->> 'invalid')::boolean and not (r ->> 'is_current')::boolean, 'unknown link is flagged, not an error';

  perform end_game('test-admin', old_ev);
  assert not (select join_open from events where id = old_ev), 'ending closes registration';

  -- next event: nothing is wiped
  r := admin_create_event('test-admin', '第二场');
  new_ev := (r ->> 'event_id')::uuid;
  new_token := r ->> 'join_token';
  assert r ->> 'title' = '第二场' and r ->> 'phase' = 'waiting', 'new event created';
  assert new_token is distinct from 'old-token', 'new QR token generated';
  assert length(r ->> 'staff_code') = 6 and length(r ->> 'screen_token') = 16, 'staff code and screen token issued';
  assert (select count(*) from players where event_id = old_ev) = 1, 'old roster kept';
  assert (select count(*) from players where event_id = new_ev) = 0, 'new roster empty';

  r := game_landing('old-token');
  assert not (r ->> 'is_current')::boolean and r ->> 'phase' = 'ended', 'old QR reports the ended event';

  r := admin_dashboard('test-admin');
  assert jsonb_array_length(r -> 'events') = 2, 'dashboard lists both events';
  -- Both rows share one transaction timestamp here, so order is not asserted; presence is.
  assert exists (select 1 from jsonb_array_elements(r -> 'events') e where e ->> 'title' = '第二场')
     and exists (select 1 from jsonb_array_elements(r -> 'events') e where e ->> 'title' = '测试场'), 'both events listed';

  r := admin_console('test-admin', new_ev);
  assert r -> 'current' ->> 'title' = '第二场', 'console opens the requested event';
  assert jsonb_array_length(r -> 'events') = 2, 'console carries the event list';
  assert jsonb_array_length(r -> 'station_metrics') = 9, 'console returns every station';

  r := admin_event_detail('test-admin', old_ev);
  assert not (r ->> 'is_current')::boolean, 'ended event detail is marked historical';
  assert jsonb_array_length(r -> 'players') = 1, 'ended event keeps live relational detail';

  -- 站点改名与改计分模式的覆盖搬到 18_station_library.sql：
  -- 库里改自建站点走 admin_library_update，改本场的名字走 admin_set_event_stations。

  -- access: change admin password, rotate one event's staff code
  r := admin_update_access('test-admin', 'new-admin-pass', new_ev);
  assert (r ->> 'admin_key_changed')::boolean and length(r ->> 'staff_code') = 6, 'password changed, staff code rotated';
  assert (select staff_code from events where id = new_ev) = r ->> 'staff_code', 'rotated code persisted';
  assert staff_session(r ->> 'staff_code') ->> 'title' = '第二场', 'new staff code logs into the new event';
  perform admin_dashboard('new-admin-pass');

  -- old link can no longer admit
  begin
    perform join_by_link('旧链接玩家', 'old-token');
    raise exception 'TEST FAILED: expected GAME_ARCHIVED';
  exception when others then
    if sqlerrm <> 'GAME_ARCHIVED' then raise; end if;
  end;

  -- one playing event per organisation
  perform join_by_link('新场玩家', new_token);
  perform start_game('new-admin-pass', new_ev, '{}'::jsonb);
  begin
    perform admin_create_event('new-admin-pass', '第三场');
    raise exception 'TEST FAILED: expected ACTIVE_EVENT_EXISTS';
  exception when others then
    if sqlerrm <> 'ACTIVE_EVENT_EXISTS' then raise; end if;
  end;

  raise notice 'PASS 10_game_sessions';
end $$;
rollback;
