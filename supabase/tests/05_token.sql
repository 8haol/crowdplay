-- Tests: use_token — hint / grace_card / second_chance rules, one token only
begin;
delete from rpc_results; delete from admin_actions; delete from token_usages;
delete from life_events; delete from life_event_instances; delete from attempts;
delete from team_attempts; delete from players; delete from teams;
update app_config set value = 'test-admin' where key = 'admin_key';
update app_config set value = 'test-staff' where key = 'staff_key';
update game_state set phase = 'playing', join_passphrase = 'pass', started_at = now() where id = 1;

do $$
declare
  v_music int := (select id from stations where slug = 'music');
  v_uk    int := (select id from stations where slug = 'uk-life');
  r jsonb;
begin
  insert into players (name, code, identity) values
    ('A', '4001', 'solo'), ('B', '4002', 'solo'), ('C', '4003', 'solo');

  -- hint: records usage, burns token
  r := use_token('test-staff', '4001', 'hint', null, 'tk1');
  assert r ->> 'usage_type' = 'hint', 'hint recorded';
  assert not (select token_available from players where code = '4001'), 'token burned';
  assert (select count(*) from token_usages t join players p on p.id = t.player_id
          where p.code = '4001' and t.usage_type = 'hint') = 1, 'usage row';

  -- second use: no token left
  begin
    perform use_token('test-staff', '4001', 'grace_card');
    raise exception 'TEST FAILED: expected NO_TOKEN';
  exception when others then
    if sqlerrm <> 'NO_TOKEN:4001' then raise; end if;
  end;

  -- idempotent replay of the first use still returns success, still one row
  r := use_token('test-staff', '4001', 'hint', null, 'tk1');
  assert r ->> 'usage_type' = 'hint', 'replay returns stored result';
  assert (select count(*) from token_usages t join players p on p.id = t.player_id
          where p.code = '4001') = 1, 'replay adds no usage row';

  -- grace_card: record only
  perform use_token('test-staff', '4002', 'grace_card');
  assert not (select token_available from players where code = '4002'), 'token burned';

  -- second_chance requires a station
  begin
    perform use_token('test-staff', '4003', 'second_chance');
    raise exception 'TEST FAILED: expected STATION_REQUIRED';
  exception when others then
    if sqlerrm <> 'STATION_REQUIRED' then raise; end if;
  end;

  -- second_chance requires that station to be failed
  begin
    perform use_token('test-staff', '4003', 'second_chance', v_music);
    raise exception 'TEST FAILED: expected NOT_FAILED_STATION';
  exception when others then
    if sqlerrm <> 'NOT_FAILED_STATION:4003' then raise; end if;
  end;
  -- a passed station does not qualify either
  perform award_scores('test-staff', '[{"code":"4003","score":6}]'::jsonb, v_music, 'tk2');
  begin
    perform use_token('test-staff', '4003', 'second_chance', v_music);
    raise exception 'TEST FAILED: expected NOT_FAILED_STATION (passed)';
  exception when others then
    if sqlerrm <> 'NOT_FAILED_STATION:4003' then raise; end if;
  end;

  -- happy path: fail uk-life, buy a second chance there
  perform award_scores('test-staff', '[{"code":"4003","failed":true}]'::jsonb, v_uk, 'tk3');
  r := use_token('test-staff', '4003', 'second_chance', v_uk, 'tk4');
  assert (r ->> 'target_station_id')::int = v_uk, 'target recorded';
  assert (select count(*) from attempts a join players p on p.id = a.player_id
          where p.code = '4003' and a.station_id = v_uk and a.status = 'retry_granted') = 1,
         'retry_granted attempt created';
  assert not (select token_available from players where code = '4003'), 'token burned';

  -- bad usage type
  begin
    perform use_token('test-staff', '4002', 'teleport');
    raise exception 'TEST FAILED: expected BAD_USAGE_TYPE';
  exception when others then
    if sqlerrm <> 'BAD_USAGE_TYPE' then raise; end if;
  end;

  raise notice 'PASS 05_token';
end $$;
rollback;
