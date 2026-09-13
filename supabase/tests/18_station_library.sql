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
  v_music int := (select id from stations where slug = 'music' and org_id is null);
  v_photo int := (select id from stations where slug = 'photo' and org_id is null);
  v_life int := (select id from stations where slug = 'life-event' and org_id is null);
  v_copy int;
  v_beta_empty uuid;
  v_beta_new uuid;
  v_used int;
  v_team uuid;
  v_player uuid;
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

  -- 整份提交：必须留人生盲盒和至少一个主站点。
  begin
    perform admin_set_event_stations('alpha-admin', ev_c,
      (select jsonb_agg(jsonb_build_object('station_id', es.station_id, 'name_zh', es.name_zh,
                                           'scoring_mode', es.scoring_mode, 'sort_order', es.sort_order))
       from event_stations es where es.event_id = ev_c and es.type <> 'life_event'));
    raise exception 'TEST FAILED: expected LIFE_EVENT_REQUIRED';
  exception when others then
    if sqlerrm <> 'LIFE_EVENT_REQUIRED' then raise; end if;
  end;

  begin
    perform admin_set_event_stations('alpha-admin', ev_c,
      (select jsonb_agg(jsonb_build_object('station_id', es.station_id, 'name_zh', es.name_zh,
                                           'scoring_mode', es.scoring_mode, 'sort_order', es.sort_order))
       from event_stations es where es.event_id = ev_c and es.type = 'life_event'));
    raise exception 'TEST FAILED: expected MAIN_STATION_REQUIRED';
  exception when others then
    if sqlerrm <> 'MAIN_STATION_REQUIRED' then raise; end if;
  end;

  -- 合法提交：留 3 个主站 + 盲盒，顺序重排。
  perform admin_set_event_stations('alpha-admin', ev_c,
    (select jsonb_agg(jsonb_build_object('station_id', t.station_id, 'name_zh', t.name_zh,
                                         'scoring_mode', t.scoring_mode, 'sort_order', t.rn))
     from (select es.*, row_number() over (order by es.sort_order) as rn
           from event_stations es
           where es.event_id = ev_c and (es.type = 'life_event' or es.station_id in (v_music, v_ring, v_photo))) t));
  assert (select count(*) from event_stations where event_id = ev_c) = 4, '本场只剩 4 个站';

  -- playing 之后只能撤，不能整份改。
  perform join_by_link('丙一', (select join_token from events where id = ev_c));
  perform start_game('alpha-admin', ev_c, '{}'::jsonb);
  begin
    perform admin_set_event_stations('alpha-admin', ev_c, '[]'::jsonb);
    raise exception 'TEST FAILED: expected EVENT_IN_PROGRESS';
  exception when others then
    if sqlerrm <> 'EVENT_IN_PROGRESS' then raise; end if;
  end;
  perform admin_disable_event_station('alpha-admin', ev_c, v_photo);
  assert (select disabled_at from event_stations where event_id = ev_c and station_id = v_photo) is not null,
         'playing 中可以撤站';

  -- 撤到只剩一个主站还行，撤光就不行。
  begin
    perform admin_disable_event_station('alpha-admin', ev_c, v_music);
    perform admin_disable_event_station('alpha-admin', ev_c, v_ring);
    raise exception 'TEST FAILED: expected MAIN_STATION_REQUIRED';
  exception when others then
    if sqlerrm <> 'MAIN_STATION_REQUIRED' then raise; end if;
  end;

  -- 人生盲盒撤不掉。
  begin
    perform admin_disable_event_station('alpha-admin', ev_c, v_life);
    raise exception 'TEST FAILED: expected LIFE_EVENT_REQUIRED';
  exception when others then
    if sqlerrm <> 'LIFE_EVENT_REQUIRED' then raise; end if;
  end;

  -- 撤站后总数减一，已记的分仍在，但不再计入完成数。
  -- （丙一 已在上面 join 并 start_game；这里直接用她的号，不再新开一个玩家。）
  v_player := (select id from players where event_id = ev_c and name = '丙一');
  perform award_team_score((select staff_code from events where id = ev_c),
    (select code from players where id = v_player), v_music, 9, false, 'k1');
  assert _main_station_total(ev_c) = 2, '4 个站里 3 主站，撤掉 photo 后剩 2';
  assert _main_stations_done(ev_c, v_player) = 1, '打过的 music 计入完成';
  perform admin_disable_event_station('alpha-admin', ev_c, v_music);
  assert _main_station_total(ev_c) = 1, '再撤一个主站，总数 1';
  assert _main_stations_done(ev_c, v_player) = 0, '被撤站点的成绩不再计入完成数';
  assert (select count(*) from team_attempts where event_id = ev_c and station_id = v_music) = 1,
         '历史成绩仍然留在库里';

  -- 撤站会下调第三段的解锁点。
  assert _stage_unlock_at(ev_c, 3) = 1, '第三段落在最后一个启用的主站上';

  -- 工作人员只看得到本场启用的站，撤掉的站不能再记分。
  -- （admin_create_event 随机生成 staff_code，这里改成固定码方便断言，
  --  和下面乙场同样的做法一致。）
  update events set staff_code = 'CCODE1' where id = ev_c;
  r := staff_stations('CCODE1');
  assert jsonb_array_length(r) = 2, '本场只剩 1 主站 + 盲盒';
  begin
    perform award_team_score('CCODE1', (select code from players where id = v_player), v_music, 6, false, 'k2');
    raise exception 'TEST FAILED: expected BAD_STATION';
  exception when others then
    if sqlerrm not like 'BAD_STATION%' then raise; end if;
  end;

  -- 乙场用同一个 station_id 照常记分（A 场撤站不影响 B 场）。
  -- （用返回的 event_id 精确定位新建的这一场，避免 update 撞到乙教会已有的
  --  其它场次，让 join_token / staff_code 的唯一约束报错。）
  r := admin_create_event('beta-admin', '乙场一');
  update events set join_token = 'join-b1', staff_code = 'BCODE1' where id = (r ->> 'event_id')::uuid;
  perform join_by_link('乙玩家', 'join-b1', null, 'pb');
  perform start_game('beta-admin', (select id from events where join_token='join-b1'), '{}'::jsonb);
  perform award_team_score('BCODE1', (select code from players where event_id = (select id from events where join_token='join-b1')), v_music, 9, false, 'kb');
  assert (select score from players where event_id = (select id from events where join_token='join-b1')) = 9,
         '乙场在同一个站点上照常记分';

  raise notice 'PASS 18_station_library';
end $$;
rollback;
