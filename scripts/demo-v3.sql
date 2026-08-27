-- Demo data for the V3 flow (station-driven life events, team scoring).
--
-- Produces a realistic late-game moment: 26 players, 13 teams, the front of
-- the room already through all seven stations (so the closing ceremony has a
-- 最快通关 team to award) and the tail still on station three, a spread of
-- resolved life events, one team Second Chance and one keepsake card. Leaves the
-- game in `playing` so /screen shows the progress board and /admin a live
-- console.
--
--   docker exec -i supabase_db_<project> psql -U postgres -d postgres -f - < scripts/demo-v3.sql
--
-- To preview the closing ceremony afterwards:
--   select end_game('change-me-admin');
-- Reset everything with: npx supabase db reset
do $$
declare
  s int[] := (select array_agg(id order by sort_order) from stations where type = 'main');
  token text;
  names text[] := array[
    '恩琪','浩然','以诺','心怡','约书亚','慕恩','雅各','喜乐',
    '安琪','以撒','路得','提摩太','大卫','沐恩','信望','爱莲',
    '保罗','马可','路加','彼得','以斯帖','但以理','约翰','丽百加',
    '西面','亚居拉'];
  i int;
  t record;
  p record;
  pending jsonb;
  scored int;
begin
  delete from rpc_results; delete from admin_actions; delete from token_usages;
  delete from life_events; delete from life_event_instances; delete from attempts;
  delete from team_attempts; delete from players; delete from teams;
  update game_state set phase = 'waiting', join_open = true, started_at = null,
    ended_at = null, title = '2026 Glasgow 新生迎新会' where id = 1;
  select join_token into token from game_state where id = 1;

  for i in 1..array_length(names, 1) loop
    perform join_by_link(names[i], token);
  end loop;

  perform start_game('change-me-admin', '{"trio":4,"duo":5}'::jsonb);

  -- Walk the room through the stations at different speeds, resolving whatever
  -- life events open on the way. Teams formed later stop earlier, which is what
  -- a real hall looks like: a couple of teams have finished everything while
  -- others are still on station three.
  for i in 1..7 loop
    scored := 0;
    for t in select (select min(mem.code) from players mem where mem.team_id = tm.id and not mem.is_removed) code
             from teams tm order by tm.created_at loop
      scored := scored + 1;
      -- the tail of the room has not reached the later stations yet
      exit when i = 7 and scored > 2;
      exit when i = 6 and scored > 3;
      exit when i = 5 and scored > 6;
      exit when i = 4 and scored > 8;
      exit when i = 3 and scored > 11;
      perform award_team_score('change-me-staff', t.code, s[i],
        (array[3, 6, 9, 9, 6, 9])[1 + ((scored + i) % 6)],
        ((scored + i) % 11 = 0),
        format('demo-%s-%s', i, t.code));
    end loop;

    -- Most players resolve their event quickly; a couple are left pending so
    -- the board and the admin console both show the "手机待选" state.
    for p in select code from players where locked_for_life_event
             and code not in (select code from players order by code limit 2) loop
      pending := poll_player(p.code) -> 'pending_event';
      if pending is not null then
        perform choose_life_event_by_link(token, p.code, (pending ->> 'id')::uuid,
          pending -> 'choices' -> floor(random() * jsonb_array_length(pending -> 'choices'))::int ->> 'key',
          format('demo-event-%s-%s', i, p.code));
      end if;
    end loop;
  end loop;

  -- One team spends its Second Chance on a station it failed.
  for t in
    select (select min(mem.code) from players mem where mem.team_id = tm.id and not mem.is_removed) code,
           a.station_id
    from team_attempts a join teams tm on tm.id = a.team_id
    where a.status = 'failed'
      and not exists (select 1 from players pl where pl.team_id = tm.id and not pl.token_available)
    order by tm.created_at limit 1
  loop
    perform use_team_token('change-me-staff', t.code, 'second_chance', t.station_id, 'demo-token');
  end loop;

  -- One player takes the keepsake card instead, mid-event.
  for p in
    select code from players where token_available and not is_removed order by code desc limit 1
  loop
    perform redeem_token_card('change-me-staff', p.code, 'demo-card');
  end loop;

  raise notice 'demo ready: % players, % teams, % stamps, % life events',
    (select count(*) from players),
    (select count(*) from teams),
    (select count(*) from team_attempts where status in ('passed','failed')),
    (select count(*) from life_events);
end $$;
