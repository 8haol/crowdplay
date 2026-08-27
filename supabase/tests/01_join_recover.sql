-- Tests: join_game / recover_identity / poll_player basics
begin;
delete from rpc_results; delete from admin_actions; delete from token_usages;
delete from life_events; delete from life_event_instances; delete from attempts;
delete from team_attempts; delete from players; delete from teams;
update app_config set value = 'test-admin' where key = 'admin_key';
update app_config set value = 'test-staff' where key = 'staff_key';
update game_state set phase = 'waiting', join_passphrase = 'pass', started_at = null where id = 1;

do $$
declare
  r jsonb;
  v_code text;
begin
  -- wrong passphrase
  begin
    perform join_game('小明', 'wrong');
    raise exception 'TEST FAILED: expected BAD_PASSPHRASE';
  exception when others then
    if sqlerrm <> 'BAD_PASSPHRASE' then raise; end if;
  end;

  -- empty name
  begin
    perform join_game('   ', 'pass');
    raise exception 'TEST FAILED: expected BAD_NAME';
  exception when others then
    if sqlerrm <> 'BAD_NAME' then raise; end if;
  end;

  -- happy path: 4-digit code, never 0000, identity null while waiting
  r := join_game('小明', 'pass');
  v_code := r ->> 'code';
  assert v_code ~ '^\d{4}$', 'code must be 4 digits, got ' || v_code;
  assert v_code <> '0000', 'code must not be 0000';
  assert (select identity from players where code = v_code) is null,
         'identity must be null while waiting';

  -- recover by code
  r := recover_identity(v_code);
  assert r ->> 'name' = '小明', 'recover returns the player';
  assert (r ->> 'score')::int = 0, 'fresh player has score 0';

  -- recover unknown code
  begin
    perform recover_identity('0000');
    raise exception 'TEST FAILED: expected PLAYER_NOT_FOUND';
  exception when others then
    if sqlerrm <> 'PLAYER_NOT_FOUND:0000' then raise; end if;
  end;

  -- poll returns merged state
  r := poll_player(v_code);
  assert r ->> 'phase' = 'waiting', 'poll includes phase';
  assert r -> 'player' ->> 'code' = v_code, 'poll includes player';
  assert jsonb_array_length(r -> 'attempts') = 0, 'no attempts yet';
  assert (r ->> 'rank')::int = 1, 'rank present';

  -- joining mid-game gets solo identity immediately
  update game_state set phase = 'playing' where id = 1;
  r := join_game('迟到者', 'pass');
  assert (select identity from players where code = r ->> 'code') = 'solo',
         'late joiner becomes solo';
  assert (select color_group from players where code = r ->> 'code') like 'solo-%',
         'late solo receives a solo color';

  -- joining after the game ended is rejected
  update game_state set phase = 'ended' where id = 1;
  begin
    perform join_game('太晚了', 'pass');
    raise exception 'TEST FAILED: expected GAME_ENDED';
  exception when others then
    if sqlerrm <> 'GAME_ENDED' then raise; end if;
  end;

  raise notice 'PASS 01_join_recover';
end $$;
rollback;
