-- Tests: 站点库归属与每场启用配置。
begin;
delete from events; delete from organizations;
insert into organizations (slug, name_zh, name_en, admin_key) values
  ('alpha', '甲教会', 'Alpha Church', 'alpha-admin'),
  ('beta',  '乙教会', 'Beta Church',  'beta-admin');

do $$
declare
  org_a uuid := (select id from organizations where slug = 'alpha');
  ev_a uuid;
  ev_b uuid;
  ev_c uuid;
  r jsonb;
  v_ring int := (select id from stations where slug = 'ring-toss' and org_id is null);
  v_copy int;
  v_beta_empty uuid;
  v_beta_new uuid;
  v_used int;
  v_team uuid;
begin
  -- 内置站点的 org_id 为 null，所有机构可见。
  assert (select count(*) from stations where org_id is null) = 9, '9 个内置站点';

  -- 机构自建站点挂在自己名下，slug 只需机构内唯一。
  insert into stations (org_id, slug, name_zh, type, scoring_mode, sort_order)
  values (org_a, 'music', '甲家的音乐', 'main', 'free', 10);
  assert (select count(*) from stations where slug = 'music') = 2, '同名 slug 可以分属内置与机构';

  -- 建场后回填：event_stations 至少能插入并受唯一约束保护。
  insert into events (org_id, title, join_token, staff_code, screen_token)
  values (org_a, '甲场', 'join-a', 'ALPHA1', 'screen-a') returning id into ev_a;
  insert into event_stations (event_id, station_id, name_zh, type, scoring_mode, sort_order)
  select ev_a, s.id, s.name_zh, s.type, s.scoring_mode, s.sort_order from stations s where s.org_id is null;
  assert (select count(*) from event_stations where event_id = ev_a) = 9, '本场启用 9 个站';

  begin
    insert into event_stations (event_id, station_id, name_zh, type, scoring_mode, sort_order)
    values (ev_a, (select id from stations where slug = 'music' and org_id is null), '重复', 'main', 'graded', 1);
    raise exception 'TEST FAILED: expected unique_violation';
  exception when unique_violation then null;
  end;

  -- 第一次建场：内置 9 个全启用。
  r := admin_create_event('alpha-admin', '甲场二');
  ev_b := (r ->> 'event_id')::uuid;
  assert (select count(*) from event_stations where event_id = ev_b) = 9, '首场默认启用内置 9 个';

  -- 单事务里 now() 是冻结的，手工拉开时间差，让「最近一场」确定无疑。
  update events set created_at = created_at - interval '1 hour' where id <> ev_b;

  -- 本场改名 + 撤掉恩典站，再建下一场时整份复制过来，且撤掉的恢复启用。
  update event_stations set name_zh = '甲家的套圈' where event_id = ev_b and station_id = v_ring;
  update event_stations set disabled_at = now() where event_id = ev_b and type = 'grace';
  r := admin_create_event('alpha-admin', '甲场三');
  ev_c := (r ->> 'event_id')::uuid;
  assert (select name_zh from event_stations where event_id = ev_c and station_id = v_ring) = '甲家的套圈',
         '复制上一场改过的名字';
  assert (select count(*) from event_stations where event_id = ev_c and disabled_at is null) = 9,
         '复制时撤掉的站恢复启用';

  -- 库只对自己开放：甲看不到乙的自建站，也改不了内置站。
  r := admin_station_library('alpha-admin');
  assert jsonb_array_length(r -> 'builtin') = 9, '内置 9 个对所有机构可见';
  assert jsonb_array_length(r -> 'custom') = 1, '甲只看见自己那 1 个自建站';
  assert jsonb_array_length(admin_station_library('beta-admin') -> 'custom') = 0, '乙看不见甲的自建站';

  begin
    perform admin_library_update('alpha-admin', v_ring, '改内置', 'graded', 6);
    raise exception 'TEST FAILED: expected FORBIDDEN';
  exception when others then
    if sqlerrm <> 'FORBIDDEN' then raise; end if;
  end;

  begin
    perform admin_library_delete('alpha-admin', v_ring);
    raise exception 'TEST FAILED: expected FORBIDDEN';
  exception when others then
    if sqlerrm <> 'FORBIDDEN' then raise; end if;
  end;

  -- 复制内置站为自己的，再改名。
  r := admin_library_copy('alpha-admin', v_ring);
  v_copy := (r ->> 'id')::int;
  assert (select org_id from stations where id = v_copy) = org_a, '复制出来的站归甲所有';
  perform admin_library_update('alpha-admin', v_copy, '甲家套圈', 'free', 11);
  assert (select scoring_mode from stations where id = v_copy) = 'free', '自建站可以改计分模式';

  begin
    perform admin_library_update('beta-admin', v_copy, '乙来改', 'graded', 1);
    raise exception 'TEST FAILED: expected FORBIDDEN';
  exception when others then
    if sqlerrm <> 'FORBIDDEN' then raise; end if;
  end;

  -- 没被任何场次启用过才能真删。
  perform admin_library_delete('alpha-admin', v_copy);
  assert not exists (select 1 from stations where id = v_copy), '未被启用过的自建站可删';

  -- event_stations 没引用，但 team_attempts 已经记过分：也不能删，得是 STATION_IN_USE 而不是裸外键错误。
  r := admin_library_create('alpha-admin', '甲家的测试站', 'life_event');
  v_used := (r ->> 'id')::int;
  assert not exists (select 1 from event_stations where station_id = v_used), '新建的站还没被任何场次引用';
  insert into teams (event_id, code, identity) values (ev_a, 'DELT', 'solo') returning id into v_team;
  insert into team_attempts (event_id, team_id, station_id, status) values (ev_a, v_team, v_used, 'passed');
  begin
    perform admin_library_delete('alpha-admin', v_used);
    raise exception 'TEST FAILED: expected STATION_IN_USE';
  exception when others then
    if sqlerrm <> 'STATION_IN_USE' then raise; end if;
  end;

  -- Ruling 10：机构「上一场」的 event_stations 为空时，新场不能跟着复制出 0 个站，得回退到内置 9 个。
  insert into events (org_id, title, join_token, staff_code, screen_token)
  select id, '乙场（空名册）', 'join-beta-empty', 'BETA00', 'screen-beta-empty'
  from organizations where slug = 'beta'
  returning id into v_beta_empty;
  assert (select count(*) from event_stations where event_id = v_beta_empty) = 0, '乙场空名册没有任何站点';
  r := admin_create_event('beta-admin', '乙场二');
  v_beta_new := (r ->> 'event_id')::uuid;
  assert (select count(*) from event_stations where event_id = v_beta_new) = 9,
         '上一场站点名册为空时，新场回退到内置 9 个';

  raise notice 'PASS 18_station_library';
end $$;
rollback;
