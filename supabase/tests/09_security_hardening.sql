-- Tests: credential surface, hashed admin secret, token throttling, safe RPCs
begin;
delete from events; delete from organizations;
insert into organizations (slug, name_zh, name_en, admin_key)
values ('tc', '测试教会', 'Test Church', '{sha256}' || encode(extensions.digest('secure-admin', 'sha256'), 'hex'));
insert into events (org_id, title, join_token, staff_code, screen_token)
select id, '测试场', 'join-t', 'STAFF1', 'screen-t' from organizations where slug = 'tc';

do $$
declare
  v_ev uuid := (select id from events where join_token = 'join-t');
  r jsonb;
  started timestamptz;
begin
  assert to_regclass('public.leaderboard') is null, 'cross-tenant leaderboard view is gone';
  assert to_regclass('public.game_state') is null and to_regclass('public.app_config') is null,
         'singleton tables are gone';
  assert has_function_privilege('anon', 'board_snapshot(text)', 'execute'), 'anon can read the code-free board RPC';
  assert not has_function_privilege('anon', '_event_by(text,text)', 'execute'), 'resolver stays internal';
  assert not has_table_privilege('anon', 'events', 'select') and not has_table_privilege('anon', 'organizations', 'select'),
         'tenant tables are not readable directly';

  -- hashed admin secret matches; plaintext staff code works case-insensitively
  perform admin_list_players('secure-admin', v_ev);
  assert staff_session('staff1') ->> 'title' = '测试场', 'staff code is case-insensitive';
  r := join_by_link('安全测试', 'join-t');
  assert r ->> 'code' ~ '^[1-9]\d{2}$', 'join works';

  -- guessing a player code is throttled
  started := clock_timestamp();
  begin
    perform recover_by_link('join-t', '000');
    raise exception 'TEST FAILED: expected PLAYER_NOT_FOUND';
  exception when others then
    if sqlerrm <> 'PLAYER_NOT_FOUND:000' then raise; end if;
  end;
  assert clock_timestamp() - started >= interval '700 milliseconds', 'invalid player-code guesses are throttled';

  -- guessing a staff code is throttled too
  started := clock_timestamp();
  begin
    perform staff_session('ZZZZZZ');
    raise exception 'TEST FAILED: expected BAD_STAFF_KEY';
  exception when others then
    if sqlerrm <> 'BAD_STAFF_KEY' then raise; end if;
  end;
  assert clock_timestamp() - started >= interval '700 milliseconds', 'invalid staff-code guesses are throttled';

  raise notice 'PASS 09_security_hardening';
end $$;
rollback;
