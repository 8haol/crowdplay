-- V3 regression: exactly three life events per passport, driven by completed
-- stations (3 / 5 / 7) instead of score gates, plus the closing ceremony payload.
begin;
delete from rpc_results; delete from admin_actions; delete from token_usages;
delete from life_events; delete from life_event_instances; delete from attempts;
delete from team_attempts; delete from players; delete from teams;
update app_config set value = 'stage-admin' where key = 'admin_key';
update app_config set value = 'stage-staff' where key = 'staff_key';
update game_state set phase = 'waiting', join_open = true,
  started_at = null, ended_at = null where id = 1;

do $$
declare
  v_stations int[] := (select array_agg(id order by sort_order) from stations where type = 'main');
  v_token text := (select join_token from game_state where id = 1);
  v_code text;
  v_team text;
  v_player jsonb;
  pending jsonb;
  i int;
  v_awards jsonb;
begin
  insert into players (name, code) values ('独行侠', '9301');
  perform start_game('stage-admin', '{}'::jsonb);
  select code into v_code from players where name = '独行侠';
  select t.code into v_team from teams t join players p on p.team_id = t.id where p.code = v_code;

  -- Walk the seven stations one at a time, resolving each event as it arrives.
  for i in 1..7 loop
    perform award_team_score('stage-staff', v_team, v_stations[i], 3, false, 'stage-s' || i);
    v_player := poll_player(v_code) -> 'player';
    assert (v_player ->> 'stations_done')::int = i, 'stations_done tracks real stamps';

    if i in (1, 2, 4, 6) then
      assert poll_player(v_code) -> 'pending_event' = 'null'::jsonb
             or poll_player(v_code) -> 'pending_event' is null,
             'no event is owed after station ' || i;
    else
      pending := poll_player(v_code) -> 'pending_event';
      assert pending is not null, 'station ' || i || ' opens a life event';
      assert (pending ->> 'stage')::int = case i when 3 then 1 when 5 then 2 else 3 end,
             'stage matches the station milestone';
      -- 3 points a station means this passport is far below every score gate,
      -- so these three events can only have come from the station gate.
      assert (v_player ->> 'score')::int < coalesce((select _stage_score_gate((pending ->> 'stage')::int)), 999),
             'the station gate fires for a low-scoring passport';
      perform choose_life_event_by_link(v_token, v_code, (pending ->> 'id')::uuid,
        pending -> 'choices' -> 0 ->> 'key', 'stage-e' || i);
    end if;
  end loop;

  -- Exactly three, and the passport says so without mentioning a score.
  assert (select count(*) from life_event_instances i2 join players p on p.id = i2.player_id
          where p.code = v_code) = 3, 'exactly three life events per passport';
  v_player := poll_player(v_code) -> 'player';
  assert (v_player ->> 'life_events_done')::int = 3, 'all three resolved';
  assert (v_player ->> 'life_events_total')::int = 3, 'the target is three';
  assert v_player -> 'next_event_stage' = 'null'::jsonb, 'nothing left to trigger';
  assert (v_player ->> 'stations_done')::int = 7, 'seven stamps';
  assert (v_player ->> 'stations_total')::int = 7, 'seven stations in play';
  assert not (v_player ? 'next_threshold'),
         'the score-shaped progress field is gone for good';

  -- A brand-new passport that joins late owes nothing yet.
  perform join_by_link('迟到的人', v_token);
  v_player := poll_player((select code from players where name = '迟到的人')) -> 'player';
  assert (v_player ->> 'next_event_stage')::int = 1, 'a late joiner still gets all three';
  assert (v_player ->> 'next_event_after_station')::int = 3, 'first one lands after three stations';

  -- Closing ceremony
  perform end_game('stage-admin');
  v_awards := board_snapshot() -> 'awards';
  assert v_awards is not null, 'awards appear once the game ends';
  assert jsonb_array_length(v_awards -> 'podium') = 2, 'podium lists everyone present';
  -- Finishing the station run is the ONE team achievement (stations are scored
  -- once per team), so team_awards holds exactly that and nothing else. The
  -- retired 挑战王 / 满分收藏家 measured the same station score twice, which
  -- always resolved to the same team.
  assert jsonb_array_length(v_awards -> 'team_awards') = 1,
         'the station run is worth exactly one team award';
  assert v_awards -> 'team_awards' -> 0 ->> 'key' = 'fastest',
         'and that award is the finish line';
  assert not exists (
    select 1 from jsonb_array_elements((v_awards -> 'team_awards') || (v_awards -> 'specials')) a
    where a ->> 'key' in ('challenger', 'perfectionist')
  ), 'the duplicate station-score awards are retired everywhere';
  assert not exists (
    select 1 from jsonb_array_elements(v_awards -> 'specials') a
    where a ->> 'key' = 'fastest'
  ), 'team metrics never become individual awards';
  -- 人生过山车 is a spread (best minus worst), not a single maximum, so a room
  -- full of players who each caught one +9 does not tie on the same number.
  assert exists (
    select 1 from _award_stats() s join players p on p.id = s.player_id
    where p.code = v_code and s.ev_swing = s.ev_up - s.ev_down and s.ev_count = 3
  ), 'the rollercoaster metric is the distance between best and worst';
  assert not exists (
    select 1 from jsonb_array_elements(v_awards -> 'specials') a
    group by a ->> 'key' having count(*) > 1
  ), 'every award has exactly one winner';
  assert not exists (
    select 1 from jsonb_array_elements(v_awards -> 'specials') a where a ? 'team_code'
  ), 'awards carry no team code';

  raise notice 'PASS 13_journey_stages';
end $$;
rollback;
