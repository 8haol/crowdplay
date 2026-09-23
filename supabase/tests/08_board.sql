-- Tests: board_snapshot — payload shape, privacy (no codes), feed contents, awards
begin;
delete from events; delete from organizations;
insert into organizations (slug, name_zh, name_en, admin_key) values ('tc', '测试教会', 'Test Church', 'test-admin');
insert into events (org_id, title, join_token, staff_code, screen_token, phase, started_at)
select id, '测试场', 'join-t', 'STAFF1', 'screen-t', 'playing', now() from organizations where slug = 'tc';
-- 这场是手工插入的（不经过 admin_create_event），进度助手/记分校验现在按本场 event_stations
-- 算站点数，所以要像 18_station_library.sql 里 ev_a 那样手动把内置站点铺进本场。
insert into event_stations (event_id, station_id, name_zh, type, scoring_mode, sort_order)
select e.id, s.id, s.name_zh, s.type, s.scoring_mode, s.sort_order
from events e, stations s where e.join_token = 'join-t' and s.org_id is null;

do $$
declare
  v_ev uuid := (select id from events where join_token = 'join-t');
  v_music int := (select id from stations where slug = 'music');
  v_uk    int := (select id from stations where slug = 'uk-life');
  t_red uuid; t_solo uuid; t_junk uuid;
  pending jsonb;
  r jsonb;
  v_feed jsonb;
begin
  t_red := _make_team(v_ev, 'trio', 'red'); t_solo := _make_team(v_ev, 'solo', 'solo-1'); t_junk := _make_team(v_ev, 'solo', 'solo-2');
  insert into players (event_id, name, code, identity, color_group, team_id) values
    (v_ev, '甲', '701', 'trio', 'red', t_red), (v_ev, '乙', '702', 'trio', 'red', t_red),
    (v_ev, '丙', '703', 'solo', 'solo-1', t_solo), (v_ev, '垃圾', '704', 'solo', 'solo-2', t_junk);
  perform admin_remove_player('test-admin', v_ev, '704');

  -- bad screen token
  begin
    perform board_snapshot('not-a-screen');
    raise exception 'TEST FAILED: expected BAD_SCREEN_TOKEN';
  exception when others then
    if sqlerrm <> 'BAD_SCREEN_TOKEN' then raise; end if;
  end;

  -- empty game still returns a well-formed payload with what the projector needs
  r := board_snapshot('screen-t');
  assert r ->> 'phase' = 'playing', 'phase present';
  assert r ->> 'title' = '测试场' and r ->> 'join_token' = 'join-t', 'board carries title and join link for the QR';
  assert r -> 'org' ->> 'name_zh' = '测试教会', 'board carries the organisation';
  assert jsonb_array_length(r -> 'players') = 3, 'removed player excluded';
  assert jsonb_array_length(r -> 'feed') = 0, 'feed empty before any action';
  assert (r -> 'stats' ->> 'players')::int = 3, 'stats count excludes removed';

  -- PRIVACY
  assert not exists (select 1 from jsonb_array_elements(r -> 'players') p where p ? 'code'), 'players carry no code field';
  assert position('staff_code' in r::text) = 0 and position('screen_token' in r::text) = 0, 'board leaks no keys';

  -- generate activity: team pass, solo fail, token, life event
  perform award_team_score('STAFF1', '701', v_music, 9, false, 'b1');
  perform award_team_score('STAFF1', '703', v_music, 0, true, 'b2');
  perform award_team_score('STAFF1', '701', v_uk, 9, false, 'b3');       -- red now 18 → stage 1 pending
  perform use_team_token('STAFF1', '703', 'second_chance', v_music, 'b4');
  pending := poll_player_by_link('join-t', '701') -> 'pending_event';
  perform choose_life_event_by_link('join-t', '701', (pending ->> 'id')::uuid, pending -> 'choices' -> 0 ->> 'key', 'b5');

  r := board_snapshot('screen-t');
  v_feed := r -> 'feed';
  assert exists (select 1 from jsonb_array_elements(r -> 'players') p
                 where p ->> 'name' = '乙' and (p ->> 'stations_done')::int = 2 and p ->> 'id' is not null),
         'progress and stable id present for every row';
  -- Ruling 20：硬编码而不是镜像 _main_station_total 自己的口径（夹具铺了全部 9 个内置
  -- 站，其中 7 个是 main，一个都没撤）——镜像写法对任何名册都恒成立，测不出回归。
  assert (r ->> 'stations_total')::int = 7, 'station total present';
  assert r -> 'awards' = 'null'::jsonb or r -> 'awards' is null, 'no awards while running';

  assert jsonb_array_length(v_feed) = 5, 'feed = 3 team attempts + 1 token + 1 life event, got ' || jsonb_array_length(v_feed)::text;
  assert v_feed -> 0 ->> 'kind' = 'life_event', 'newest first (life event was last)';
  assert exists (select 1 from jsonb_array_elements(v_feed) f where f ->> 'kind' = 'attempt' and (f ->> 'score')::int = 9 and f ->> 'station' = '音乐之声'), 'perfect score in feed';
  assert exists (select 1 from jsonb_array_elements(v_feed) f where f ->> 'kind' = 'attempt' and f ->> 'status' = 'failed' and f ->> 'name' = '丙'), 'failure in feed';
  assert exists (select 1 from jsonb_array_elements(v_feed) f where f ->> 'kind' = 'token' and f ->> 'usage' = 'second_chance' and f ->> 'station' = '音乐之声'), 'token use in feed with station';
  assert not exists (select 1 from jsonb_array_elements(v_feed) f where f ? 'code'), 'feed carries no code field';

  -- locked flag (乙 still has stage 1 pending)
  assert exists (select 1 from jsonb_array_elements(r -> 'players') p where p ->> 'name' = '乙' and (p ->> 'locked')::boolean), 'locked flag exposed';

  -- sick flag
  update players set status_effect = '{"type":"cap_next","value":1}'::jsonb where code = '703';
  assert exists (select 1 from jsonb_array_elements(board_snapshot('screen-t') -> 'players') p where p ->> 'name' = '丙' and (p ->> 'sick')::boolean), 'cap_next surfaces as sick';

  -- ceremony payload only once the game is over
  perform end_game('test-admin', v_ev);
  r := board_snapshot('screen-t');
  assert jsonb_array_length(r -> 'awards' -> 'podium') = 3, 'podium has three places';
  assert (r -> 'awards' -> 'podium' -> 0 ->> 'rank')::int = 1, 'podium carries its place';
  assert not exists (select 1 from jsonb_array_elements(r -> 'awards' -> 'specials') a where a ? 'code'), 'awards carry no code';

  -- anon can call it (projector page, no auth)
  set local role anon;
  r := board_snapshot('screen-t');
  assert jsonb_array_length(r -> 'players') = 3, 'anon may read the board';
  reset role;

  raise notice 'PASS 08_board';
end $$;
-- ---------------------------------------------------------------------------
-- 颁奖（2026-09-23 定稿）：前三名（同队包揽就改队伍领奖台）+ 最快通关 + 3 个个人奖，不重复。
-- 用一场新的 playing 场次：上面的 join-t 已经 ended，而且 players 被 attempts /
-- life_events 的裸外键引用，删不掉。
-- ---------------------------------------------------------------------------
insert into events (org_id, title, join_token, staff_code, screen_token, phase, started_at)
select id, '奖池场', 'join-p', 'STAFF2', 'screen-p', 'playing', now() from organizations where slug = 'tc';
insert into event_stations (event_id, station_id, name_zh, type, scoring_mode, sort_order)
select e.id, s.id, s.name_zh, s.type, s.scoring_mode, s.sort_order
from events e, stations s where e.join_token = 'join-p' and s.org_id is null;

do $$
declare
  v_ev uuid := (select id from events where join_token = 'join-p');
  mains int[] := (select array_agg(s.id order by s.sort_order) from stations s where s.org_id is null and s.type = 'main');
  t_a uuid; t_b uuid; t_c uuid; t_d uuid; t_e uuid; t0 timestamptz; r jsonb; names text[]; i int;
begin
  t_a := _make_team(v_ev, 'trio', 'red'); t_b := _make_team(v_ev, 'duo', 'blue');
  t_c := _make_team(v_ev, 'solo', 'solo-1'); t_d := _make_team(v_ev, 'duo', 'green');
  insert into players (event_id, name, code, identity, color_group, team_id) values
    (v_ev, 'A1', '801', 'trio', 'red', t_a), (v_ev, 'A2', '802', 'trio', 'red', t_a), (v_ev, 'A3', '803', 'trio', 'red', t_a),
    (v_ev, 'B1', '804', 'duo', 'blue', t_b), (v_ev, 'B2', '805', 'duo', 'blue', t_b),
    (v_ev, 'C1', '806', 'solo', 'solo-1', t_c),
    (v_ev, 'D1', '807', 'duo', 'green', t_d), (v_ev, 'D2', '808', 'duo', 'green', t_d);
  -- red: all 7 mains at 9 (63 each; fastest + most nines + top scores)
  -- blue: 7 mains, one 9 and six 3 (27 each; second most nines)
  -- solo C1: 3 mains at 3 (9); green duo: 7 mains at 6 (42 each, no nines) → the median sits here
  for i in 1..7 loop perform award_team_score('STAFF2', '801', mains[i], 9, false, 'r' || i); end loop;
  for i in 1..7 loop perform award_team_score('STAFF2', '804', mains[i], case when i = 1 then 9 else 3 end, false, 'b' || i); end loop;
  for i in 1..3 loop perform award_team_score('STAFF2', '806', mains[i], 3, false, 'c' || i); end loop;
  for i in 1..7 loop perform award_team_score('STAFF2', '807', mains[i], 6, false, 'd' || i); end loop;
  update players set locked_for_life_event = false, pending_threshold = null where event_id = v_ev;
  update life_event_instances set state = 'cancelled' where event_id = v_ev and state = 'pending';
  update events set phase = 'ended', ended_at = now() where id = v_ev;

  -- 颁奖 7 个（2026-09-23 定稿）。个人前三全是红队 → 整场改成队伍领奖台：
  -- 平均分 红 63 / 绿 42 / 蓝 27，独行 C1 只有 9 分落选。
  r := _event_awards(v_ev);
  assert r ->> 'podium_mode' = 'team', 'same-team top three switches to a team podium: ' || r::text;
  assert (select array_agg(p ->> 'color_group' order by (p ->> 'rank')::int) from jsonb_array_elements(r -> 'podium') p) = array['red', 'green', 'blue'],
    'team podium ranks by average score: ' || (r -> 'podium')::text;
  assert (r -> 'podium' -> 0 ->> 'score')::numeric = 63 and r -> 'podium' -> 0 ->> 'kind' = 'team'
     and r -> 'podium' -> 0 ->> 'members' like '%A1%A%A%' and (r -> 'podium' -> 0 ->> 'member_count')::int = 3, 'team podium entry carries members + average: ' || (r -> 'podium' -> 0)::text;
  -- 最快通关跳过领奖台上的队；C1 没走完 → 这场不发
  assert jsonb_array_length(r -> 'team_awards') = 0, 'no fastest: every finisher is on the podium: ' || (r -> 'team_awards')::text;
  -- 没有际遇 → 只剩独行明星
  assert jsonb_array_length(r -> 'specials') = 1 and r -> 'specials' -> 0 ->> 'key' = 'solo_star' and r -> 'specials' -> 0 ->> 'name' = 'C1'
     and r -> 'specials' -> 0 ->> 'caption' = '独自出发，9 分', 'solo star is always tried first: ' || (r -> 'specials')::text;
  assert not exists (select 1 from jsonb_array_elements(r -> 'team_awards') a where a ->> 'key' = 'full_moon'), 'full moon is retired';

  -- 个人领奖台：前三来自三个不同的队
  update players set score = 70 where code = '801';
  update players set score = 60 where code = '804';
  update players set score = 50 where code = '807';
  update players set score = 25 where code = '802';
  update players set score = 20 where code = '803';
  -- 新来一个 E 队，和 C1 都走完 7 站；C1 先凑齐，之后用再挑战重打一站
  t_e := _make_team(v_ev, 'duo', 'violet');
  insert into players (event_id, name, code, identity, color_group, team_id) values
    (v_ev, 'E1', '809', 'duo', 'violet', t_e), (v_ev, 'E2', '810', 'duo', 'violet', t_e);
  update events set phase = 'playing', ended_at = null where id = v_ev;
  for i in 4..7 loop perform award_team_score('STAFF2', '806', mains[i], 3, false, 'c' || i); end loop;
  for i in 1..7 loop perform award_team_score('STAFF2', '809', mains[i], 3, false, 'e' || i); end loop;
  update players set locked_for_life_event = false, pending_threshold = null where event_id = v_ev;
  update life_event_instances set state = 'cancelled' where event_id = v_ev and state = 'pending';
  update events set phase = 'ended', ended_at = now() where id = v_ev;
  t0 := (select started_at from events where id = v_ev);
  update team_attempts ta set created_at = t0 + make_interval(mins => 10 + array_position(mains, ta.station_id)) where team_id = t_c;
  update team_attempts ta set created_at = t0 + make_interval(mins => 20 + array_position(mains, ta.station_id)) where team_id = t_e;
  update team_attempts set status = 'superseded' where team_id = t_c and station_id = mains[7];
  insert into team_attempts (event_id, team_id, station_id, score, status, scored_by, created_at)
  values (v_ev, t_c, mains[7], 6, 'passed', 'staff', t0 + interval '40 minutes');

  -- 际遇：A2 净 +5；B2 最后一下 -4 且再没涨（不算逆袭）；D2 两次都没丢分
  delete from life_events where event_id = v_ev;
  insert into life_events (event_id, player_id, card_type, card_label, score_before, score_after)
  select v_ev, id, 'x', 'up', 20, 25 from players where code = '802';
  insert into life_events (event_id, player_id, card_type, card_label, score_before, score_after)
  select v_ev, id, 'x', 'down', 31, 27 from players where code = '805';
  update players set score = 27 where code = '805';
  insert into life_events (event_id, player_id, card_type, card_label, score_before, score_after)
  select v_ev, id, 'x', v.l, v.b, v.a from players, (values ('up', 10, 13), ('flat', 20, 20)) v(l, b, a) where code = '808';

  r := _event_awards(v_ev);
  assert r ->> 'podium_mode' = 'player', 'three different teams keep the personal podium: ' || r::text;
  assert (select array_agg(p ->> 'name' order by (p ->> 'rank')::int) from jsonb_array_elements(r -> 'podium') p) = array['A1', 'B1', 'D1'],
    'personal podium by score: ' || (r -> 'podium')::text;
  -- 最快通关按第一次凑齐 7 站算（C1 第 17 分钟），重打不往后推；E 第 27 分钟
  assert jsonb_array_length(r -> 'team_awards') = 1 and r -> 'team_awards' -> 0 ->> 'key' = 'fastest'
     and r -> 'team_awards' -> 0 ->> 'members' = 'C1', 'fastest counts the first time all stations were in: ' || (r -> 'team_awards')::text;
  assert r -> 'team_awards' -> 0 ->> 'caption' = '开局 17 分钟走完 7 站', 'caption is minutes, not a place: ' || (r -> 'team_awards')::text;
  -- C1 拿了最快通关 → 没有独行新面孔；池子补满 3 个
  assert (select array_agg(s ->> 'key' || ':' || (s ->> 'name')) from jsonb_array_elements(r -> 'specials') s) = array['lucky:A2', 'unlucky:B2', 'steady:D2'],
    'pool fills three fresh faces, comeback needs a real rebound: ' || (r -> 'specials')::text;
  assert r -> 'specials' -> 2 ->> 'caption' = '2 次际遇，一分没丢', 'steady caption';

  -- 所有奖项里没有人出现两次
  assert (select count(*) from (
      select p ->> 'name' n from jsonb_array_elements(r -> 'podium') p
      union all select a ->> 'members' from jsonb_array_elements(r -> 'team_awards') a
      union all select s ->> 'name' from jsonb_array_elements(r -> 'specials') s) x)
    = (select count(distinct n) from (
      select p ->> 'name' n from jsonb_array_elements(r -> 'podium') p
      union all select a ->> 'members' from jsonb_array_elements(r -> 'team_awards') a
      union all select s ->> 'name' from jsonb_array_elements(r -> 'specials') s) x), 'nobody wins twice';

  -- 月下逆袭：谷底只看扣分那几次，要求真的回升
  update players set score = 40 where code = '805';
  r := _event_awards(v_ev);
  assert not exists (select 1 from jsonb_array_elements(r -> 'specials') s where s ->> 'key' = 'comeback'), 'comeback stays behind lucky + unlucky in the pool';
  assert (select name from players where id = _pick_award(v_ev, 'min_after is not null and score > min_after', '(score - min_after) desc', '{}')) = 'B2',
    'comeback: B2 fell to 27 and finished on 40';
  assert (select min_after from _award_stats(v_ev) where name = 'A2') is null, 'an up-only card is never a low point';

  -- the board carries the same awards once the event is over
  r := board_snapshot('screen-p') -> 'awards';
  assert r ->> 'podium_mode' = 'player' and jsonb_array_length(r -> 'podium') = 3 and jsonb_array_length(r -> 'team_awards') = 1, 'board_snapshot serves the awards';
  raise notice 'OK award lineup';
end $$;
rollback;
