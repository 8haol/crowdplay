-- Tests: 押后公布排名。押后期间名次不出库、公布后回来、幂等、兑底、权限。
begin;
delete from events; delete from organizations;
insert into organizations (slug, name_zh, name_en, admin_key) values
  ('alpha', '甲教会', 'Alpha Church', 'alpha-admin'),
  ('beta',  '乙教会', 'Beta Church',  'beta-admin');

do $$
declare
  v_alpha uuid := (select id from organizations where slug = 'alpha');
  v_beta  uuid := (select id from organizations where slug = 'beta');
  ev uuid; ev_playing uuid; ev_beta uuid;
  r jsonb;
  v_at timestamptz;
begin
  insert into events (org_id, title, join_token, staff_code, screen_token, phase, started_at)
  values (v_alpha, '要结束的场', 'join-a', 'AAA111', 'scr-a', 'playing', now()) returning id into ev;
  insert into events (org_id, title, join_token, staff_code, screen_token, phase, started_at)
  values (v_alpha, '还在进行', 'join-p', 'AAA222', 'scr-p', 'playing', now()) returning id into ev_playing;
  insert into events (org_id, title, join_token, staff_code, screen_token, phase)
  values (v_beta, '乙场', 'join-b', 'BBB333', 'scr-b', 'waiting') returning id into ev_beta;

  insert into players (event_id, code, name, score) values
    (ev, '0001', '第一名', 50),
    (ev, '0002', '第二名', 30);
  insert into players (event_id, code, name, score) values (ev_playing, '0003', '进行中', 20);

  -- 0. 还没结束：名次照常给，押后只存在于 ended
  r := poll_player_by_link('join-p', '0003');
  assert (r ->> 'rank')::int = 1, '进行中的场次名次照常';
  assert (r ->> 'ranks_published')::boolean, '进行中不算押后';

  -- 1. 结束之后：名次根本不离开数据库
  perform end_game('alpha-admin', ev);
  r := poll_player_by_link('join-a', '0002');
  assert r -> 'rank' = 'null'::jsonb, '押后期间 rank 是 null';
  assert r -> 'team_rank' = 'null'::jsonb, '押后期间 team_rank 也是 null';
  assert not (r ->> 'ranks_published')::boolean, 'ranks_published 为 false';
  assert (r -> 'player' ->> 'score')::int = 30, '总分照常给 —— 遮的是名次不是分数';

  -- 2. 未结束的场次不能公布
  begin
    perform publish_ranks('alpha-admin', ev_playing);
    raise exception 'TEST FAILED: expected EVENT_NOT_ENDED';
  exception when others then
    if sqlerrm <> 'EVENT_NOT_ENDED' then raise; end if;
  end;

  -- 3. 跨机构公布不动
  begin
    perform publish_ranks('beta-admin', ev);
    raise exception 'TEST FAILED: expected EVENT_NOT_FOUND';
  exception when others then
    if sqlerrm <> 'EVENT_NOT_FOUND' then raise; end if;
  end;
  assert (select ranks_published_at is null from events where id = ev), '乙点不动甲的公布';

  -- 4. 公布之后名次回来
  r := publish_ranks('alpha-admin', ev);
  v_at := (r ->> 'ranks_published_at')::timestamptz;
  assert v_at is not null, '返回公布时刻';
  r := poll_player_by_link('join-a', '0002');
  assert (r ->> 'rank')::int = 2, '第二名拿到 2';
  assert (r ->> 'ranks_published')::boolean, 'ranks_published 为 true';
  r := poll_player_by_link('join-a', '0001');
  assert (r ->> 'rank')::int = 1, '第一名拿到 1';

  -- 5. 幂等：再点一次不把时间往后推
  perform pg_sleep(0.01);
  r := publish_ranks('alpha-admin', ev);
  assert (r ->> 'ranks_published_at')::timestamptz = v_at, '重复公布时间不变';

  -- 6. 兑底：主持人忘了点，十五分钟后自己放出来
  update events set ranks_published_at = null, ended_at = now() - interval '16 minutes' where id = ev;
  r := poll_player_by_link('join-a', '0002');
  assert (r ->> 'rank')::int = 2, '过了兑底时间，没公布也拿得到名次';
  assert (r ->> 'ranks_published')::boolean, '兑底之后算已公布';

  -- 7. 兑底之前仍然押后
  update events set ended_at = now() - interval '5 minutes' where id = ev;
  r := poll_player_by_link('join-a', '0002');
  assert r -> 'rank' = 'null'::jsonb, '五分钟还没到兑底，继续押后';

  -- 8. fail open：ended_at 不知为何丢了，宁可放名次也不要把人永久锁住
  update events set ended_at = null where id = ev;
  r := poll_player_by_link('join-a', '0002');
  assert (r ->> 'rank')::int = 2, 'ended_at 为空时不押后';

  raise notice 'PASS 22_publish_ranks';
end $$;
rollback;
