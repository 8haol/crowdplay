-- supabase/tests/20_event_theme.sql
-- Tests: events.theme — default, create/update, validation, and every payload that carries it
begin;
delete from events; delete from organizations;
insert into organizations (slug, name_zh, name_en, admin_key) values ('tc', '测试教会', 'Test Church', 'test-admin');

do $$
declare
  r jsonb; ev uuid; landing jsonb;
begin
  -- default
  r := admin_create_event('test-admin', '默认场');
  assert r ->> 'theme' = 'passport', 'new event defaults to passport, got ' || coalesce(r ->> 'theme', 'null');
  ev := (r ->> 'event_id')::uuid;

  -- update
  r := admin_update_game('test-admin', ev, null, null, 'midautumn');
  assert r ->> 'theme' = 'midautumn', 'theme updated';
  r := admin_update_game('test-admin', ev, '改名', null, null);
  assert r ->> 'theme' = 'midautumn', 'null p_theme leaves theme alone';

  -- validation
  begin
    perform admin_update_game('test-admin', ev, null, null, 'halloween');
    raise exception 'TEST FAILED: expected BAD_THEME';
  exception when others then
    if sqlerrm <> 'BAD_THEME' then raise; end if;
  end;
  begin
    perform admin_create_event('test-admin', '坏主题', 'halloween');
    raise exception 'TEST FAILED: expected BAD_THEME';
  exception when others then
    if sqlerrm <> 'BAD_THEME' then raise; end if;
  end;

  -- payloads
  landing := game_landing((select join_token from events where id = ev));
  assert landing ->> 'theme' = 'midautumn', 'game_landing carries theme';
  assert staff_session((select staff_code from events where id = ev)) ->> 'theme' = 'midautumn', 'staff_session carries theme';
  assert board_snapshot((select screen_token from events where id = ev)) ->> 'theme' = 'midautumn', 'board_snapshot carries theme';
  r := join_by_link('甲', (select join_token from events where id = ev));
  assert poll_player_by_link((select join_token from events where id = ev), r ->> 'code') ->> 'theme' = 'midautumn', 'poll carries theme';

  -- create with theme
  perform admin_delete_event('test-admin', ev, '改名');
  r := admin_create_event('test-admin', '中秋场', 'midautumn');
  assert r ->> 'theme' = 'midautumn', 'create with theme';
  raise notice 'OK 20_event_theme';
end $$;
rollback;
