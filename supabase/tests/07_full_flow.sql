-- End-to-end smoke test: a miniature game played start to finish through the public RPCs only.
begin;
delete from events; delete from organizations;
insert into organizations (slug, name_zh, name_en, admin_key) values ('tc', '测试教会', 'Test Church', 'test-admin');
insert into events (org_id, title, join_token, staff_code, screen_token, phase, started_at)
select id, '测试场', 'join-t', 'STAFF1', 'screen-t', 'waiting', null from organizations where slug = 'tc';

do $$
declare
  v_ev uuid := (select id from events where join_token = 'join-t');
  v_stations int[] := (select array_agg(id order by sort_order) from stations where type = 'main');
  c1 text; c2 text; c3 text;
  pending jsonb;
  r jsonb;
begin
  -- three friends scan the same QR
  c1 := join_by_link('恩琪', 'join-t') ->> 'code';
  c2 := join_by_link('浩然', 'join-t') ->> 'code';
  c3 := join_by_link('以诺', 'join-t') ->> 'code';

  -- one of them loses localStorage and recovers by code
  assert recover_by_link('join-t', c2) ->> 'name' = '浩然', 'recovery works';

  -- admin starts the game: one trio
  r := start_game('test-admin', v_ev, '{"trio":1}'::jsonb);
  assert (r ->> 'trio_groups')::int = 1, 'one trio formed';
  assert poll_player_by_link('join-t', c1) ->> 'phase' = 'playing', 'players see the phase flip';
  assert poll_player_by_link('join-t', c1) -> 'player' ->> 'identity' = 'trio', 'identity revealed';

  -- station 1: the whole trio is scored once
  perform award_team_score('STAFF1', c1, v_stations[1], 9, false, 'flow-s1');
  assert (poll_player_by_link('join-t', c2) -> 'player' ->> 'score')::int = 9, 'team scoring reaches every passport';

  -- station 2 fails; the team spends its tokens on a Second Chance and passes
  perform award_team_score('STAFF1', c3, v_stations[2], 0, true, 'flow-s2');
  perform use_team_token('STAFF1', c1, 'second_chance', v_stations[2], 'flow-t1');
  perform award_team_score('STAFF1', c2, v_stations[2], 3, false, 'flow-s2b');
  assert (poll_player_by_link('join-t', c3) -> 'player' ->> 'score')::int = 12, 'retry rescued the team';

  -- station 3 pushes past 15 and past the third station: stage 1 opens for everyone
  perform award_team_score('STAFF1', c1, v_stations[3], 6, false, 'flow-s3');
  pending := poll_player_by_link('join-t', c1) -> 'pending_event';
  assert pending is not null and (pending ->> 'stage')::int = 1, 'stage 1 owed';
  r := choose_life_event_by_link('join-t', c1, (pending ->> 'id')::uuid, pending -> 'choices' -> 0 ->> 'key', 'flow-le1');
  assert r ->> 'outcome_label' is not null, 'life event resolved on the phone';

  -- game ends; ranks are final and the projector shows awards
  perform end_game('test-admin', v_ev);
  assert poll_player_by_link('join-t', c2) ->> 'phase' = 'ended', 'players see the end';
  assert (poll_player_by_link('join-t', c2) ->> 'rank')::int between 1 and 3, 'rank present';
  assert jsonb_array_length(board_snapshot('screen-t') -> 'awards' -> 'podium') = 3, 'podium on the projector';

  raise notice 'PASS 07_full_flow';
end $$;
rollback;
