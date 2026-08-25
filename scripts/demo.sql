-- Demo: play a small game end-to-end through the real RPCs and COMMIT the
-- data, so you can browse the result in Supabase Studio.
-- Reset everything afterwards with: npx supabase db reset
\set QUIET on
\pset footer off

do $$
declare
  s int[] := (select array_agg(id order by sort_order) from stations where type = 'main');
  c1 text; c2 text; c3 text; c4 text; c5 text;
begin
  -- fresh slate
  delete from rpc_results; delete from admin_actions; delete from token_usages;
  delete from life_events; delete from attempts; delete from players;
  update game_state set phase = 'waiting', join_passphrase = 'change-me', started_at = null;

  -- 5 people join with the passphrase
  c1 := join_game('恩琪', 'change-me') ->> 'code';
  c2 := join_game('浩然', 'change-me') ->> 'code';
  c3 := join_game('以诺', 'change-me') ->> 'code';
  c4 := join_game('心怡', 'change-me') ->> 'code';
  c5 := join_game('约书亚', 'change-me') ->> 'code';
  raise notice '玩家 4 位码: 恩琪=%, 浩然=%, 以诺=%, 心怡=%, 约书亚=%', c1, c2, c3, c4, c5;

  -- admin starts: 1 trio + 1 duo, remainder solo
  perform start_game('change-me-admin', '{"trio":1,"duo":1}'::jsonb);

  -- station 1: trio scored as one batch (individual scores)
  perform award_scores('change-me-staff', jsonb_build_array(
    jsonb_build_object('code', c1, 'score', 9),
    jsonb_build_object('code', c2, 'score', 6),
    jsonb_build_object('code', c3, 'failed', true)), s[1], 'demo-1');

  -- station 2: c1 crosses 15 -> locked for the blind box
  perform award_scores('change-me-staff', jsonb_build_array(
    jsonb_build_object('code', c1, 'score', 9),
    jsonb_build_object('code', c2, 'score', 3)), s[2], 'demo-2');

  -- blind box: fortune_double 18 -> 36 (skips 35, next threshold 45)
  perform apply_life_event('change-me-staff', c1, 'fortune_double', 'demo-le');

  -- grace station: c3 buys a Second Chance for station 1 and passes with 6
  perform use_token('change-me-staff', c3, 'second_chance', s[1], 'demo-t');
  perform award_scores('change-me-staff', jsonb_build_array(
    jsonb_build_object('code', c3, 'score', 6)), s[1], 'demo-3');

  -- some scores for the duo
  perform award_scores('change-me-staff', jsonb_build_array(
    jsonb_build_object('code', c4, 'score', 6),
    jsonb_build_object('code', c5, 'score', 6)), s[3], 'demo-4');
end $$;

\echo '=== 排行榜 (leaderboard 视图) ==='
select * from leaderboard;
\echo '=== 玩家状态 ==='
select code, name, identity, color_group, score, token_available as token,
       locked_for_life_event as locked, next_threshold
from players order by score desc;
\echo '=== 挑战记录 (attempts) ==='
select p.name, st.name_zh as station, a.status, a.score
from attempts a join players p on p.id = a.player_id
join stations st on st.id = a.station_id order by a.id;
\echo '=== 人生盲盒记录 ==='
select p.name, e.card_label, e.score_before, e.score_after
from life_events e join players p on p.id = e.player_id;
