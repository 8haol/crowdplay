-- End-to-end smoke test: a miniature game played start to finish through the
-- public RPCs only (no direct table writes for game actions).
begin;
delete from rpc_results; delete from admin_actions; delete from token_usages;
delete from life_events; delete from life_event_instances; delete from attempts;
delete from team_attempts; delete from players; delete from teams;
update app_config set value = 'test-admin' where key = 'admin_key';
update app_config set value = 'test-staff' where key = 'staff_key';
update game_state set phase = 'waiting', join_passphrase = '欢迎回家', started_at = null where id = 1;

do $$
declare
  v_stations int[] := (select array_agg(id order by sort_order)
                       from stations where type = 'main');
  c1 text; c2 text; c3 text;
  r jsonb;
begin
  -- three friends join with the venue passphrase
  c1 := join_game('恩琪', '欢迎回家') ->> 'code';
  c2 := join_game('浩然', '欢迎回家') ->> 'code';
  c3 := join_game('以诺', '欢迎回家') ->> 'code';

  -- one of them loses localStorage and recovers by code
  r := recover_identity(c2);
  assert r ->> 'name' = '浩然', 'recovery works';

  -- admin starts the game: one trio
  r := start_game('test-admin', '{"trio":1}'::jsonb);
  assert (r ->> 'trio_groups')::int = 1, 'one trio formed';
  assert (poll_player(c1)) ->> 'phase' = 'playing', 'players see the phase flip';
  assert (poll_player(c1)) -> 'player' ->> 'identity' = 'trio', 'identity revealed';

  -- station 1: the whole trio is scored in one batch; each keeps their own score
  r := award_scores('test-staff',
        jsonb_build_array(
          jsonb_build_object('code', c1, 'score', 9),
          jsonb_build_object('code', c2, 'score', 6),
          jsonb_build_object('code', c3, 'failed', true)),
        v_stations[1], 'flow-s1');
  assert (poll_player(c1)) -> 'player' ->> 'score' = '9', 'individual scoring';

  -- c3 spends the token on a Second Chance at station 1 and passes
  perform use_token('test-staff', c3, 'second_chance', v_stations[1], 'flow-t1');
  perform award_scores('test-staff',
    jsonb_build_array(jsonb_build_object('code', c3, 'score', 3)),
    v_stations[1], 'flow-s1b');
  assert (poll_player(c3)) -> 'player' ->> 'score' = '3', 'retry rescued c3';

  -- c1 pushes past 15 at station 2 and gets locked
  r := award_scores('test-staff',
    jsonb_build_array(jsonb_build_object('code', c1, 'score', 9)),
    v_stations[2], 'flow-s2');
  assert (r -> 'results' -> 0 ->> 'life_event_triggered')::boolean, 'threshold hit at 18';
  assert (poll_player(c1)) -> 'player' ->> 'locked_for_life_event' = 'true',
         'player app shows the lock';

  -- blind box: fortune_double -> 36, which is already past 35: skipped, next = 45
  r := apply_life_event('test-staff', c1, 'fortune_double', 'flow-le1');
  assert (r ->> 'score_after')::int = 36, 'doubled to 36';
  assert (poll_player(c1)) -> 'player' ->> 'next_threshold' = '45', '35 skipped';
  assert (poll_player(c1)) -> 'player' ->> 'locked_for_life_event' = 'false', 'unlocked';

  -- game ends; leaderboard is final
  perform end_game('test-admin');
  assert (poll_player(c1)) ->> 'phase' = 'ended', 'players see the end';
  assert (select code from leaderboard limit 1) = c1, 'c1 tops the board';
  assert (poll_player(c1)) ->> 'rank' = '1', 'rank matches';

  raise notice 'PASS 07_full_flow';
end $$;
rollback;
