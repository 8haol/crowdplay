-- V3.3 regression: free 0..10 scoring, balanced event odds, physical hint
-- registration, and low-score retries that replace rather than stack scores.
begin;
delete from rpc_results; delete from admin_actions; delete from token_usages;
delete from life_events; delete from life_event_instances; delete from attempts;
delete from team_attempts; delete from players; delete from teams;
update app_config set value = 'v33-admin' where key = 'admin_key';
update app_config set value = 'v33-staff' where key = 'staff_key';
update game_state set phase = 'waiting', join_open = true,
  started_at = null, ended_at = null where id = 1;

do $$
declare
  v_interview int := (select id from stations where slug = 'interview');
  v_music int := (select id from stations where slug = 'music');
  v_team text;
  v_hint_team text;
  v_code text;
  v_hint_code text;
  v_choice jsonb;
  v_positive int;
  v_nonpositive int;
  r jsonb;
begin
  assert (select scoring_mode from stations where id = v_interview) = 'free',
    '灵魂拷问 uses free scoring';

  -- Every action gives at least half of its relative probability to outcomes
  -- that do not increase the score.
  for v_choice in
    select choice from life_event_scenes s
    cross join lateral jsonb_array_elements(s.choices) choice
    where s.active
  loop
    select
      coalesce(sum((o ->> 'weight')::int) filter (where
        coalesce((o ->> 'multiplier')::int, 100) > 100
        or (coalesce((o ->> 'multiplier')::int, 100) = 100 and coalesce((o ->> 'delta')::int, 0) > 0)
      ), 0),
      coalesce(sum((o ->> 'weight')::int) filter (where not (
        coalesce((o ->> 'multiplier')::int, 100) > 100
        or (coalesce((o ->> 'multiplier')::int, 100) = 100 and coalesce((o ->> 'delta')::int, 0) > 0)
      )), 0)
    into v_positive, v_nonpositive
    from jsonb_array_elements(v_choice -> 'outcomes') o;
    assert v_nonpositive >= v_positive,
      'neutral/bad probability must be at least half for choice ' || (v_choice ->> 'key');
  end loop;

  insert into players (name, code) values ('重挑队', '951'), ('提示队', '952');
  perform start_game('v33-admin', '{}'::jsonb);
  select t.code, p.code into v_team, v_code
  from teams t join players p on p.team_id = t.id where p.name = '重挑队';
  select t.code, p.code into v_hint_team, v_hint_code
  from teams t join players p on p.team_id = t.id where p.name = '提示队';

  -- A hint can be registered before that team has played any station. The
  -- physical card handoff happens at the Grace station, outside the database.
  r := use_team_token('v33-staff', v_hint_team, 'hint', null, 'v33-hint');
  assert r ->> 'usage_type' = 'hint', 'pre-challenge hint is accepted';
  assert not (select token_available from players where code = v_hint_code),
    'hint consumes the token';

  -- 0 and 10 are both valid free scores; values outside the range are not.
  begin
    perform award_team_score('v33-staff', v_team, v_interview, 11, false, 'v33-bad-score');
    raise exception 'TEST FAILED: expected BAD_TEAM_SCORE';
  exception when others then
    if sqlerrm <> 'BAD_TEAM_SCORE' then raise; end if;
  end;
  perform award_team_score('v33-staff', v_team, v_interview, 4, false, 'v33-first-score');
  assert (select score from players where code = v_code) = 4, 'free score is recorded';

  -- A station the team never played still cannot be called a re-challenge.
  begin
    perform use_team_token('v33-staff', v_team, 'second_chance', v_music, 'v33-unplayed');
    raise exception 'TEST FAILED: expected TEAM_NOT_ATTEMPTED';
  exception when others then
    if sqlerrm not like 'TEAM_NOT_ATTEMPTED:%' then raise; end if;
  end;

  -- A passed but disappointing result can be retried. The new 8 replaces 4,
  -- so both the passport and the team accumulator end on 8, not 12.
  perform use_team_token('v33-staff', v_team, 'second_chance', v_interview, 'v33-retry-grant');
  perform award_team_score('v33-staff', v_team, v_interview, 8, false, 'v33-retry-score');
  assert (select score from players where code = v_code) = 8,
    'retry replaces personal score';
  assert (select challenge_score from teams where code = v_team) = 8,
    'retry replaces team score';
  assert exists (select 1 from team_attempts where team_id = (select id from teams where code = v_team)
    and station_id = v_interview and status = 'superseded' and score = 4),
    'old result remains in the audit trail';
  assert exists (select 1 from team_attempts where team_id = (select id from teams where code = v_team)
    and station_id = v_interview and status = 'passed' and score = 8),
    'new result is the active station result';

  raise notice 'PASS 15_scoring_balance_and_help';
end $$;
rollback;
