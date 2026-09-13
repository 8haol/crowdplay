-- V3 regression: exactly three life events per passport, driven by completed stations (3 / 5 / 7), plus the ceremony payload.
begin;
delete from events; delete from organizations;
insert into organizations (slug, name_zh, name_en, admin_key) values ('tc', '测试教会', 'Test Church', 'test-admin');
insert into events (org_id, title, join_token, staff_code, screen_token, phase, started_at)
select id, '测试场', 'join-t', 'STAFF1', 'screen-t', 'waiting', null from organizations where slug = 'tc';
-- 这场是手工插入的（不经过 admin_create_event），进度助手/记分校验现在按本场 event_stations
-- 算站点数，所以要像 18_station_library.sql 里 ev_a 那样手动把内置站点铺进本场。
insert into event_stations (event_id, station_id, name_zh, type, scoring_mode, sort_order)
select e.id, s.id, s.name_zh, s.type, s.scoring_mode, s.sort_order
from events e, stations s where e.join_token = 'join-t' and s.org_id is null;

do $$
declare
  v_ev uuid := (select id from events where join_token = 'join-t');
  v_stations int[] := (select array_agg(id order by sort_order) from stations where type = 'main');
  v_code text; v_team text; v_player jsonb; pending jsonb; i int; v_awards jsonb;
begin
  insert into players (event_id, name, code) values (v_ev, '独行侠', '931');
  perform start_game('test-admin', v_ev, '{}'::jsonb);
  select code into v_code from players where name = '独行侠';
  select t.code into v_team from teams t join players p on p.team_id = t.id where p.code = v_code;

  for i in 1..7 loop
    perform award_team_score('STAFF1', v_team, v_stations[i], 3, false, 'stage-s' || i);
    v_player := poll_player_by_link('join-t', v_code) -> 'player';
    assert (v_player ->> 'stations_done')::int = i, 'stations_done tracks real stamps';
    if i in (1, 2, 4, 6) then
      assert poll_player_by_link('join-t', v_code) -> 'pending_event' = 'null'::jsonb
             or poll_player_by_link('join-t', v_code) -> 'pending_event' is null, 'no event is owed after station ' || i;
    else
      pending := poll_player_by_link('join-t', v_code) -> 'pending_event';
      assert pending is not null, 'station ' || i || ' opens a life event';
      assert (pending ->> 'stage')::int = case i when 3 then 1 when 5 then 2 else 3 end, 'stage matches the station milestone';
      assert (v_player ->> 'score')::int < coalesce((select _stage_score_gate((pending ->> 'stage')::int)), 999), 'the station gate fires for a low-scoring passport';
      perform choose_life_event_by_link('join-t', v_code, (pending ->> 'id')::uuid, pending -> 'choices' -> 0 ->> 'key', 'stage-e' || i);
    end if;
  end loop;

  assert (select count(*) from life_event_instances i2 join players p on p.id = i2.player_id where p.code = v_code) = 3, 'exactly three life events per passport';
  v_player := poll_player_by_link('join-t', v_code) -> 'player';
  assert (v_player ->> 'life_events_done')::int = 3 and (v_player ->> 'life_events_total')::int = 3, 'all three resolved';
  assert v_player -> 'next_event_stage' = 'null'::jsonb, 'nothing left to trigger';
  assert (v_player ->> 'stations_done')::int = 7 and (v_player ->> 'stations_total')::int = 7, 'seven of seven';
  assert not (v_player ? 'next_threshold'), 'the score-shaped progress field is gone';

  perform join_by_link('迟到的人', 'join-t');
  v_player := poll_player_by_link('join-t', (select code from players where name = '迟到的人')) -> 'player';
  assert (v_player ->> 'next_event_stage')::int = 1 and (v_player ->> 'next_event_after_station')::int = 3, 'a late joiner still gets all three';

  perform end_game('test-admin', v_ev);
  v_awards := board_snapshot('screen-t') -> 'awards';
  assert v_awards is not null, 'awards appear once the game ends';
  assert jsonb_array_length(v_awards -> 'podium') = 2, 'podium lists everyone present';
  assert jsonb_array_length(v_awards -> 'team_awards') = 1 and v_awards -> 'team_awards' -> 0 ->> 'key' = 'fastest', 'exactly one team award: the finish line';
  assert not exists (select 1 from jsonb_array_elements((v_awards -> 'team_awards') || (v_awards -> 'specials')) a where a ->> 'key' in ('challenger', 'perfectionist')),
         'the duplicate station-score awards stay retired';
  assert exists (select 1 from _award_stats(v_ev) s join players p on p.id = s.player_id where p.code = v_code and s.ev_swing = s.ev_up - s.ev_down and s.ev_count = 3),
         'the rollercoaster metric is best minus worst';
  assert not exists (select 1 from jsonb_array_elements(v_awards -> 'specials') a group by a ->> 'key' having count(*) > 1), 'every award has exactly one winner';

  raise notice 'PASS 13_journey_stages';
end $$;
rollback;
