-- Tests: start_game — quota assignment, color groups, degradation, guards
begin;
delete from events; delete from organizations;
insert into organizations (slug, name_zh, name_en, admin_key) values ('tc', '测试教会', 'Test Church', 'test-admin');
insert into events (org_id, title, join_token, staff_code, screen_token, phase, started_at)
select id, '测试场', 'join-t', 'STAFF1', 'screen-t', 'waiting', null from organizations where slug = 'tc';

do $$
declare
  v_ev uuid := (select id from events where join_token = 'join-t');
  r jsonb;
  i int;
begin
  -- bad key
  begin
    perform start_game('nope', v_ev, '{"trio":1}'::jsonb);
    raise exception 'TEST FAILED: expected BAD_KEY';
  exception when others then
    if sqlerrm <> 'BAD_KEY' then raise; end if;
  end;

  -- no players
  begin
    perform start_game('test-admin', v_ev, '{"trio":1}'::jsonb);
    raise exception 'TEST FAILED: expected NO_PLAYERS';
  exception when others then
    if sqlerrm <> 'NO_PLAYERS' then raise; end if;
  end;

  -- 10 players, quota trio=2 (6 ppl) + duo=2 (4 ppl) => 0 solo
  for i in 1..10 loop
    insert into players (event_id, name, code) values (v_ev, 'p' || i, (100 + i)::text);
  end loop;
  r := start_game('test-admin', v_ev, '{"solo":0,"duo":2,"trio":2}'::jsonb);

  assert (r ->> 'trio_groups')::int = 2, 'made 2 trio groups';
  assert (r ->> 'duo_groups')::int = 2, 'made 2 duo pairs';
  assert (r ->> 'solo_players')::int = 0, 'no solo left';
  assert (select count(*) from players where identity = 'trio') = 6, '6 trio players';
  assert (select count(*) from players where identity = 'duo') = 4, '4 duo players';
  assert (select count(*) from players where identity is null) = 0, 'everyone assigned';
  assert (select phase from events where id = v_ev) = 'playing', 'phase is playing';
  assert (select started_at from events where id = v_ev) is not null, 'started_at set';
  assert (select count(*) from teams where event_id = v_ev) = 4, 'teams belong to the event';

  assert not exists (select color_group from players where identity = 'trio' group by color_group having count(*) <> 3), 'trio groups have 3 members';
  assert not exists (select color_group from players where identity = 'duo' group by color_group having count(*) <> 2), 'duo groups have 2 members';
  assert (select count(distinct color_group) from players where color_group is not null) = 4, '4 distinct colors for 4 groups';

  -- starting twice is rejected
  begin
    perform start_game('test-admin', v_ev, '{}'::jsonb);
    raise exception 'TEST FAILED: expected ALREADY_STARTED';
  exception when others then
    if sqlerrm <> 'ALREADY_STARTED' then raise; end if;
  end;

  raise notice 'PASS 02_start_game (full quota)';
end $$;
rollback;

-- Degradation: 4 players, quota trio=2 => 1 full trio + 1 leftover solo.
begin;
delete from events; delete from organizations;
insert into organizations (slug, name_zh, name_en, admin_key) values ('tc', '测试教会', 'Test Church', 'test-admin');
insert into events (org_id, title, join_token, staff_code, screen_token, phase, started_at)
select id, '测试场', 'join-t', 'STAFF1', 'screen-t', 'waiting', null from organizations where slug = 'tc';

do $$
declare
  v_ev uuid := (select id from events where join_token = 'join-t');
  r jsonb;
  i int;
begin
  for i in 1..4 loop
    insert into players (event_id, name, code) values (v_ev, 'q' || i, (200 + i)::text);
  end loop;
  r := start_game('test-admin', v_ev, '{"trio":2,"duo":0}'::jsonb);
  assert (r ->> 'trio_groups')::int = 1, 'only 1 complete trio possible';
  assert (r ->> 'solo_players')::int = 1, 'remainder degrades to solo';
  assert (select count(*) from players where identity = 'solo') = 1, 'solo count';
  assert (select color_group from players where identity = 'solo') like 'solo-%', 'solo receives a visible solo color';
  raise notice 'PASS 02_start_game (degradation)';
end $$;
rollback;

-- Removed players are excluded from assignment
begin;
delete from events; delete from organizations;
insert into organizations (slug, name_zh, name_en, admin_key) values ('tc', '测试教会', 'Test Church', 'test-admin');
insert into events (org_id, title, join_token, staff_code, screen_token, phase, started_at)
select id, '测试场', 'join-t', 'STAFF1', 'screen-t', 'waiting', null from organizations where slug = 'tc';

do $$
declare
  v_ev uuid := (select id from events where join_token = 'join-t');
  r jsonb;
begin
  insert into players (event_id, name, code) values (v_ev, 'real', '301');
  insert into players (event_id, name, code, is_removed) values (v_ev, 'junk', '302', true);
  r := start_game('test-admin', v_ev, '{"duo":1}'::jsonb);
  assert (r ->> 'total_players')::int = 1, 'removed player not counted';
  assert (select identity from players where code = '302') is null, 'removed player not assigned';
  raise notice 'PASS 02_start_game (removed excluded)';
end $$;
rollback;
