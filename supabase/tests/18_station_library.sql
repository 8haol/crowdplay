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

  -- 本场改名 + 撤掉恩典站，再建下一场时整份复制过来，且撤掉的恢复启用。
  update event_stations set name_zh = '甲家的套圈' where event_id = ev_b and station_id = v_ring;
  update event_stations set disabled_at = now() where event_id = ev_b and type = 'grace';
  r := admin_create_event('alpha-admin', '甲场三');
  ev_c := (r ->> 'event_id')::uuid;
  assert (select name_zh from event_stations where event_id = ev_c and station_id = v_ring) = '甲家的套圈',
         '复制上一场改过的名字';
  assert (select count(*) from event_stations where event_id = ev_c and disabled_at is null) = 9,
         '复制时撤掉的站恢复启用';

  raise notice 'PASS 18_station_library';
end $$;
rollback;
