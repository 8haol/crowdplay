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
-- 奖池（spec §3，2026-09-21 定稿）：领奖台照实，最快通关是事实，其余奖只给新面孔。
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
  t_a uuid; t_b uuid; t_c uuid; t_d uuid; r jsonb; names text[]; i int;
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

  r := _event_awards(v_ev);
  -- podium is the truth: the red trio takes all three places
  select array_agg(p ->> 'name' order by (p ->> 'rank')::int) into names from jsonb_array_elements(r -> 'podium') p;
  assert array_length(names, 1) = 3 and names[1] like 'A%' and names[2] like 'A%' and names[3] like 'A%', 'podium is unrestricted top 3, got ' || names::text;
  -- team awards: red fastest; full moon goes to blue (second most nines), not to red again
  assert jsonb_array_length(r -> 'team_awards') = 2, 'two team awards, got ' || (r -> 'team_awards')::text;
  assert r -> 'team_awards' -> 0 ->> 'key' = 'fastest' and r -> 'team_awards' -> 0 ->> 'color_group' = 'red', 'red is fastest';
  assert r -> 'team_awards' -> 1 ->> 'key' = 'full_moon' and r -> 'team_awards' -> 1 ->> 'color_group' = 'blue', 'full moon skips the fastest team, got ' || (r -> 'team_awards')::text;
  assert r -> 'team_awards' -> 1 ->> 'caption' = '1 站满分', 'full moon caption counts the nines';
  -- specials never repeat a podium or team-award member
  assert not exists (select 1 from jsonb_array_elements(r -> 'specials') s where s ->> 'name' like 'A%' or s ->> 'name' like 'B%'), 'specials are fresh faces: ' || (r -> 'specials')::text;
  assert jsonb_array_length(r -> 'specials') <= 3, 'at most three specials';
  -- no life events → lucky / unlucky / comeback / grace_witness have nobody; solo star + median remain
  assert exists (select 1 from jsonb_array_elements(r -> 'specials') s where s ->> 'key' = 'solo_star' and s ->> 'name' = 'C1'), 'solo star is the solo: ' || (r -> 'specials')::text;
  assert exists (select 1 from jsonb_array_elements(r -> 'specials') s where s ->> 'key' = 'median' and s ->> 'name' like 'D%'), 'median (8 players → 4th lowest) is a green duo member: ' || (r -> 'specials')::text;
  assert jsonb_array_length(r -> 'specials') = 2, 'exactly the two awards that have a fresh face';
  assert not exists (select 1 from jsonb_array_elements(r -> 'specials') s where s ->> 'key' not in ('lucky', 'unlucky', 'comeback', 'solo_star', 'grace_witness', 'median')), 'only the six agreed keys';
  assert (select count(distinct s ->> 'name') from jsonb_array_elements(r -> 'specials') s) = jsonb_array_length(r -> 'specials'), 'no player wins two specials';

  -- the median is skipped (not re-picked from used faces) when its holder already has an award:
  -- remove the green duo so the 4th lowest of six is a blue player
  update players set is_removed = true where team_id = t_d;
  r := _event_awards(v_ev);
  assert not exists (select 1 from jsonb_array_elements(r -> 'specials') s where s ->> 'key' = 'median'), 'median is not awarded to an already-awarded face: ' || (r -> 'specials')::text;
  assert jsonb_array_length(r -> 'specials') = 1, 'fewer specials rather than a fallback';
  update players set is_removed = false where team_id = t_d;

  -- no nines anywhere except red → full moon not awarded at all
  update attempts set score = 3 where player_id in (select id from players where code in ('804', '805')) and score = 9;
  update team_attempts set score = 3 where team_id = t_b and score = 9;
  r := _event_awards(v_ev);
  assert jsonb_array_length(r -> 'team_awards') = 1 and r -> 'team_awards' -> 0 ->> 'key' = 'fastest', 'full moon skipped when only the fastest team has nines';

  -- the board carries the same awards once the event is over
  r := board_snapshot('screen-p') -> 'awards';
  assert jsonb_array_length(r -> 'podium') = 3 and jsonb_array_length(r -> 'team_awards') = 1, 'board_snapshot serves the pooled awards';
  raise notice 'OK award pool';
end $$;
rollback;
