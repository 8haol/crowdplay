-- Tests: 两个机构各一场，数据完全隔离；令牌只能打开自己那一场。
begin;
delete from events; delete from organizations;
insert into organizations (slug, name_zh, name_en, admin_key) values
  ('alpha', '甲教会', 'Alpha Church', 'alpha-admin'),
  ('beta',  '乙教会', 'Beta Church',  'beta-admin');
insert into events (org_id, title, join_token, staff_code, screen_token, phase, started_at)
select id, '甲场', 'join-alpha', 'ALPHA1', 'screen-alpha', 'waiting', null from organizations where slug = 'alpha';
insert into events (org_id, title, join_token, staff_code, screen_token, phase, started_at)
select id, '乙场', 'join-beta', 'BETA01', 'screen-beta', 'waiting', null from organizations where slug = 'beta';
-- 这两场都是手工插入的（不经过 admin_create_event），进度助手/记分校验现在按本场
-- event_stations 算，所以要像 18_station_library.sql 里 ev_a 那样手动把内置站点铺进两场。
insert into event_stations (event_id, station_id, name_zh, type, scoring_mode, sort_order)
select e.id, s.id, s.name_zh, s.type, s.scoring_mode, s.sort_order
from events e, stations s where e.join_token in ('join-alpha', 'join-beta') and s.org_id is null;

do $$
declare
  ev_a uuid := (select id from events where join_token = 'join-alpha');
  ev_b uuid := (select id from events where join_token = 'join-beta');
  v_music int := (select id from stations where slug = 'music');
  code_a text;
  code_b text;
  r jsonb;
begin
  -- 同一个编号可以同时存在于两场：唯一约束是 (event_id, code)。
  perform join_by_link('甲一', 'join-alpha', null, 'a1');
  perform join_by_link('乙一', 'join-beta', null, 'b1');
  update players set code = '327' where event_id = ev_a;
  update players set code = '327' where event_id = ev_b;
  code_a := '327'; code_b := '327';
  assert (select count(*) from players where code = '327') = 2, '两场可以各有一个 327';

  perform start_game('alpha-admin', ev_a, '{}'::jsonb);
  perform start_game('beta-admin',  ev_b, '{}'::jsonb);

  -- 甲场工作人员看不到乙场的玩家（同一个编号，落在自己场里的那个）。
  r := staff_lookup_team('ALPHA1', '327');
  assert (r ->> 'found')::boolean and r ->> 'event_title' = '甲场', '甲场 staff 码解析到甲场';
  assert (select event_id from players p where p.id = (r -> 'members' -> 0 ->> 'player_id')::uuid) = ev_a,
         '解析到的是甲场的 327，不是乙场的';

  -- 甲场工作人员给 327 录分，只有甲场的 327 涨分。
  perform award_team_score('ALPHA1', '327', v_music, 9, false, 'iso-1');
  assert (select score from players where event_id = ev_a and code = '327') = 9, '甲场 327 得 9 分';
  assert (select score from players where event_id = ev_b and code = '327') = 0, '乙场 327 不受影响';

  -- 同一个幂等键在两场互不命中。
  perform award_team_score('BETA01', '327', v_music, 3, false, 'iso-1');
  assert (select score from players where event_id = ev_b and code = '327') = 3,
         '乙场用同名幂等键照常记分，不会拿到甲场的缓存结果';

  -- 大屏：甲场的令牌只看到甲场。
  r := board_snapshot('screen-alpha');
  assert (r -> 'stats' ->> 'players')::int = 1 and r ->> 'title' = '甲场', '甲场大屏只有甲场';
  assert not exists (select 1 from jsonb_array_elements(r -> 'players') p where p ->> 'name' = '乙一'),
         '乙场玩家不出现在甲场大屏';
  assert (r -> 'stats' ->> 'stamps')::int = 1, '甲场只统计自己的盖章';

  -- 护照：甲场链接 + 乙场同号，找不到。
  begin
    perform poll_player_by_link('join-alpha', '327');
    -- 甲场也有 327，所以这条必须成功
  end;
  r := poll_player_by_link('join-alpha', '327');
  assert r -> 'org' ->> 'slug' = 'alpha' and (r -> 'player' ->> 'score')::int = 9, '甲场链接读到甲场的 327';
  r := poll_player_by_link('join-beta', '327');
  assert r -> 'org' ->> 'slug' = 'beta' and (r -> 'player' ->> 'score')::int = 3, '乙场链接读到乙场的 327';

  -- 管理端：甲机构密码打不开乙场。
  begin
    perform admin_console('alpha-admin', ev_b);
    raise exception 'TEST FAILED: expected EVENT_NOT_FOUND';
  exception when others then
    if sqlerrm <> 'EVENT_NOT_FOUND' then raise; end if;
  end;
  begin
    perform admin_list_players('alpha-admin', ev_b);
    raise exception 'TEST FAILED: expected EVENT_NOT_FOUND';
  exception when others then
    if sqlerrm <> 'EVENT_NOT_FOUND' then raise; end if;
  end;
  r := admin_dashboard('alpha-admin');
  assert jsonb_array_length(r -> 'events') = 1 and r -> 'events' -> 0 ->> 'title' = '甲场',
         '甲机构总览只列甲场';

  -- 结束甲场不影响乙场。
  perform end_game('alpha-admin', ev_a);
  assert (select phase from events where id = ev_a) = 'ended', '甲场结束';
  assert (select phase from events where id = ev_b) = 'playing', '乙场继续';
  assert (board_snapshot('screen-beta') -> 'awards') is null
      or (board_snapshot('screen-beta') -> 'awards') = 'null'::jsonb, '乙场还没有颁奖';

  -- 甲机构不能拿乙机构的场次去轮换工作人员码。
  begin
    perform admin_update_access('alpha-admin', null, ev_b);
    raise exception 'TEST FAILED: expected EVENT_NOT_FOUND';
  exception when others then
    if sqlerrm <> 'EVENT_NOT_FOUND' then raise; end if;
  end;

  raise notice 'PASS 17_tenant_isolation';
end $$;
rollback;
