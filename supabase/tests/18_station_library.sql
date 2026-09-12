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

  raise notice 'PASS 18_station_library';
end $$;
rollback;
