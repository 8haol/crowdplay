-- Tests: start_game — quota assignment, color groups, degradation, guards
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
  i int;
begin
  -- bad key
  begin
    perform start_game('nope', '{"trio":1}'::jsonb);
    raise exception 'TEST FAILED: expected BAD_KEY';
  exception when others then
    if sqlerrm <> 'BAD_KEY' then raise; end if;
  end;

  -- no players
  begin
    perform start_game('test-admin', '{"trio":1}'::jsonb);
    raise exception 'TEST FAILED: expected NO_PLAYERS';
  exception when others then
    if sqlerrm <> 'NO_PLAYERS' then raise; end if;
  end;

  -- 10 players, quota trio=2 (6 ppl) + duo=2 (4 ppl) => 0 solo
  for i in 1..10 loop
    insert into players (name, code) values ('p' || i, lpad((1000 + i)::text, 4, '0'));
  end loop;
  r := start_game('test-admin', '{"solo":0,"duo":2,"trio":2}'::jsonb);

  assert (r ->> 'trio_groups')::int = 2, 'made 2 trio groups';
  assert (r ->> 'duo_groups')::int = 2, 'made 2 duo pairs';
  assert (r ->> 'solo_players')::int = 0, 'no solo left';
  assert (select count(*) from players where identity = 'trio') = 6, '6 trio players';
  assert (select count(*) from players where identity = 'duo') = 4, '4 duo players';
  assert (select count(*) from players where identity is null) = 0, 'everyone assigned';
  assert (select phase from game_state where id = 1) = 'playing', 'phase is playing';
  assert (select started_at from game_state where id = 1) is not null, 'started_at set';

  -- every trio color group has exactly 3 members, every duo group exactly 2,
  -- and no color is shared across groups
  assert not exists (
    select color_group from players where identity = 'trio'
    group by color_group having count(*) <> 3), 'trio groups have 3 members';
  assert not exists (
    select color_group from players where identity = 'duo'
    group by color_group having count(*) <> 2), 'duo groups have 2 members';
  assert (select count(distinct color_group) from players where color_group is not null) = 4,
         '4 distinct colors for 4 groups';

  -- starting twice is rejected
  begin
    perform start_game('test-admin', '{}'::jsonb);
    raise exception 'TEST FAILED: expected ALREADY_STARTED';
  exception when others then
    if sqlerrm <> 'ALREADY_STARTED' then raise; end if;
  end;

  raise notice 'PASS 02_start_game (full quota)';
end $$;
rollback;

-- Degradation: 5 players, quota trio=2 duo=1 => 1 full trio, 1 duo, 0 remainder;
-- then 4 players, quota trio=1 duo=0 => 1 trio + 1 leftover solo.
begin;
delete from rpc_results; delete from admin_actions; delete from token_usages;
delete from life_events; delete from attempts; delete from players;
update app_config set value = 'test-admin' where key = 'admin_key';
update game_state set phase = 'waiting', join_passphrase = 'pass' where id = 1;

do $$
declare
  r jsonb;
  i int;
begin
  for i in 1..4 loop
    insert into players (name, code) values ('q' || i, lpad((2000 + i)::text, 4, '0'));
  end loop;
  -- quota asks for 2 trios (6 ppl) but only 4 exist: 1 full trio, remainder solo
  r := start_game('test-admin', '{"trio":2,"duo":0}'::jsonb);
  assert (r ->> 'trio_groups')::int = 1, 'only 1 complete trio possible';
  assert (r ->> 'solo_players')::int = 1, 'remainder degrades to solo';
  assert (select count(*) from players where identity = 'solo') = 1, 'solo count';
  assert (select color_group from players where identity = 'solo') like 'solo-%',
         'solo receives a visible solo color';
  raise notice 'PASS 02_start_game (degradation)';
end $$;
rollback;

-- Removed players are excluded from assignment
begin;
delete from rpc_results; delete from admin_actions; delete from token_usages;
delete from life_events; delete from attempts; delete from players;
update app_config set value = 'test-admin' where key = 'admin_key';
update game_state set phase = 'waiting', join_passphrase = 'pass' where id = 1;

do $$
declare
  r jsonb;
begin
  insert into players (name, code) values ('real', '3001');
  insert into players (name, code, is_removed) values ('junk', '3002', true);
  r := start_game('test-admin', '{"duo":1}'::jsonb);
  assert (r ->> 'total_players')::int = 1, 'removed player not counted';
  assert (select identity from players where code = '3002') is null,
         'removed player not assigned';
  raise notice 'PASS 02_start_game (removed excluded)';
end $$;
rollback;
