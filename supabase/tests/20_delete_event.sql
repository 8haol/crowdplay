-- Tests: 删除活动。分级确认、进行中不可删、级联干净、跨机构删不动。
begin;
delete from events; delete from organizations;
insert into organizations (slug, name_zh, name_en, admin_key) values
  ('alpha', '甲教会', 'Alpha Church', 'alpha-admin'),
  ('beta',  '乙教会', 'Beta Church',  'beta-admin');

do $$
declare
  v_alpha uuid := (select id from organizations where slug = 'alpha');
  v_beta  uuid := (select id from organizations where slug = 'beta');
  ev_empty uuid; ev_playing uuid; ev_full uuid; ev_beta uuid;
  r jsonb;
begin
  -- 四场：空的待开始、进行中、有玩家的、乙教会的
  insert into events (org_id, title, join_token, staff_code, screen_token, phase)
  values (v_alpha, '空场', 'j1', 'AAA111', 's1', 'waiting') returning id into ev_empty;
  insert into events (org_id, title, join_token, staff_code, screen_token, phase, started_at)
  values (v_alpha, '进行中', 'j2', 'AAA222', 's2', 'playing', now()) returning id into ev_playing;
  insert into events (org_id, title, join_token, staff_code, screen_token, phase)
  values (v_alpha, '有人的场', 'j3', 'AAA333', 's3', 'waiting') returning id into ev_full;
  insert into events (org_id, title, join_token, staff_code, screen_token, phase)
  values (v_beta, '乙场', 'j4', 'BBB444', 's4', 'waiting') returning id into ev_beta;

  insert into players (event_id, code, name, score)
  values (ev_full, '0001', '张三', 12), (ev_full, '0002', '李四', 8);

  -- 1. 待开始 + 零玩家：不需要 p_confirm，直接删
  r := admin_delete_event('alpha-admin', ev_empty);
  assert (r ->> 'title') = '空场', '返回被删场次的名字';
  assert (r ->> 'players_deleted')::int = 0, '空场删掉 0 个玩家';
  assert not exists (select 1 from events where id = ev_empty), '空场真的没了';

  -- 2. 进行中：一律拒绝
  begin
    perform admin_delete_event('alpha-admin', ev_playing, '进行中');
    raise exception 'TEST FAILED: expected EVENT_PLAYING';
  exception when others then
    if sqlerrm <> 'EVENT_PLAYING' then raise; end if;
  end;
  assert exists (select 1 from events where id = ev_playing), '进行中的场还在';

  -- 3. 有玩家：不给 p_confirm 要报错
  begin
    perform admin_delete_event('alpha-admin', ev_full);
    raise exception 'TEST FAILED: expected TITLE_MISMATCH';
  exception when others then
    if sqlerrm <> 'TITLE_MISMATCH' then raise; end if;
  end;
  -- 3b. 名字对不上也要报错（这里只多一个尾随空格——确认就是要逼人看清楚，
  --     所以服务端严格相等，不 trim）
  begin
    perform admin_delete_event('alpha-admin', ev_full, '有人的场 ');
    raise exception 'TEST FAILED: expected TITLE_MISMATCH';
  exception when others then
    if sqlerrm <> 'TITLE_MISMATCH' then raise; end if;
  end;
  assert exists (select 1 from events where id = ev_full), '确认失败时场次还在';

  -- 4. 名字对得上：删掉，且玩家级联清干净
  r := admin_delete_event('alpha-admin', ev_full, '有人的场');
  assert (r ->> 'players_deleted')::int = 2, '如实报告删掉 2 个玩家';
  assert not exists (select 1 from events  where id = ev_full), '场次没了';
  assert not exists (select 1 from players where event_id = ev_full), '玩家级联没了';

  -- 5. 跨机构：乙教会的口令删不动甲教会的场，反之亦然
  begin
    perform admin_delete_event('beta-admin', ev_playing, '进行中');
    raise exception 'TEST FAILED: expected EVENT_NOT_FOUND';
  exception when others then
    if sqlerrm <> 'EVENT_NOT_FOUND' then raise; end if;
  end;
  assert exists (select 1 from events where id = ev_playing), '甲的场没被乙删掉';
  assert exists (select 1 from events where id = ev_beta),    '乙的场还在';

  raise notice 'PASS 20_delete_event';
end $$;
rollback;
