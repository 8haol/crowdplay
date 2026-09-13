-- Tests: board_snapshot — payload shape, privacy (no codes), feed contents, awards
begin;
delete from events; delete from organizations;
insert into organizations (slug, name_zh, name_en, admin_key) values ('tc', '测试教会', 'Test Church', 'test-admin');
insert into events (org_id, title, join_token, staff_code, screen_token, phase, started_at)
select id, '测试场', 'join-t', 'STAFF1', 'screen-t', 'playing', now() from organizations where slug = 'tc';
-- 这场是手工插入的（不经过 admin_create_event），进度助手现在按本场 event_stations
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
  assert (r ->> 'stations_total')::int = (select count(*) from stations where type = 'main'), 'station total present';
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
rollback;
