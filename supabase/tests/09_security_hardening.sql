-- Tests: public credential surface, hashed secrets, throttling, safe leaderboard
begin;
delete from rpc_results; delete from admin_actions; delete from token_usages;
delete from life_events; delete from attempts; delete from players;
update app_config set value = '{sha256}' || encode(extensions.digest('secure-admin', 'sha256'), 'hex')
where key = 'admin_key';
update app_config set value = '{sha256}' || encode(extensions.digest('secure-staff', 'sha256'), 'hex')
where key = 'staff_key';
update game_state
set phase = 'waiting',
    join_passphrase = '{sha256}' || encode(extensions.digest('secure-join', 'sha256'), 'hex'),
    started_at = null
where id = 1;

do $$
declare
  r jsonb;
  started timestamptz;
begin
  assert not has_table_privilege('anon', 'leaderboard', 'select'),
         'anon cannot read credential-bearing leaderboard';
  assert has_table_privilege('anon', 'public_leaderboard', 'select'),
         'anon can read the code-free public leaderboard';
  assert not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'public_leaderboard' and column_name = 'code'
  ), 'safe leaderboard contains no code';

  r := join_game('安全测试', 'secure-join');
  assert r ->> 'code' ~ '^\d{4}$', 'hashed join secret matches';
  perform staff_lookup('secure-staff', array[]::text[]);
  perform admin_list_players('secure-admin');

  started := clock_timestamp();
  begin
    perform recover_identity('0000');
    raise exception 'TEST FAILED: expected PLAYER_NOT_FOUND';
  exception when others then
    if sqlerrm <> 'PLAYER_NOT_FOUND:0000' then raise; end if;
  end;
  assert clock_timestamp() - started >= interval '700 milliseconds',
         'invalid player-code guesses are deliberately throttled';

  raise notice 'PASS 09_security_hardening';
end $$;
rollback;
