-- V2.1 regression: one public score and a complete admin-only event audit.
begin;

delete from rpc_results; delete from admin_actions; delete from token_usages;
delete from life_events; delete from life_event_instances; delete from attempts;
delete from team_attempts; delete from players; delete from teams;
update app_config set value = 'review-admin' where key = 'admin_key';

do $$
declare
  v_team uuid;
  catalog jsonb;
  board jsonb;
  console jsonb;
  rejected boolean := false;
begin
  begin
    perform admin_life_event_catalog('wrong-key');
  exception when others then
    rejected := true;
  end;
  assert rejected, 'event catalog rejects a wrong admin key';

  catalog := admin_life_event_catalog('review-admin');
  assert (catalog -> 'stats' ->> 'scenes')::int = 30, 'all 30 scenes are available for review';
  assert (catalog -> 'stats' ->> 'choices')::int = 60, 'every scene exposes both actions to the admin';
  assert (catalog -> 'stats' ->> 'outcomes')::int = 180, 'all three random outcomes per action are visible';
  assert catalog -> 'stats' -> 'by_audience' = '{"all":12,"solo":6,"duo":6,"trio":6}'::jsonb,
    'audience counts are complete';
  assert exists (select 1 from life_event_scenes s
    cross join lateral jsonb_array_elements(s.choices) c
    cross join lateral jsonb_array_elements(c -> 'outcomes') o
    where (o ->> 'multiplier')::int = 50), 'catalog includes a rare half-score result';
  assert exists (select 1 from life_event_scenes s
    cross join lateral jsonb_array_elements(s.choices) c
    cross join lateral jsonb_array_elements(c -> 'outcomes') o
    where (o ->> 'multiplier')::int = 150), 'catalog includes a rare 1.5x result';
  assert not has_table_privilege('anon', 'life_event_scenes', 'select'),
    'players cannot read the hidden result table directly';

  -- /library proof-reads the same payload without the admin password, so the
  -- volunteer-facing page can never drift from what the engine actually rolls.
  assert life_event_library() = catalog,
    'the public library and the admin audit return one identical payload';
  assert has_function_privilege('anon', 'life_event_library()', 'execute'),
    'volunteers can open the library without a password';
  assert not has_function_privilege('anon', '_life_event_catalog_json()', 'execute'),
    'the shared helper itself stays internal';

  insert into teams (code, identity, color_group, challenge_score)
  values ('D01', 'duo', 'blue', 99) returning id into v_team;
  insert into players (name, code, identity, color_group, team_id, score)
  values ('高分玩家', '9201', 'duo', 'blue', v_team, 41),
         ('事件后玩家', '9202', 'duo', 'blue', v_team, 17);

  board := board_snapshot();
  -- Teammates stay adjacent; the projector no longer ranks live by score.
  assert exists (select 1 from jsonb_array_elements(board -> 'players') p
                 where p ->> 'name' = '高分玩家' and (p ->> 'score')::int = 41),
    'projector shows the personal score';
  -- Team short codes are gone from the product: teammates group by team_id and
  -- read as the same colour, and no code of any kind reaches the projector.
  assert not exists (
    select 1 from jsonb_array_elements(board -> 'players') p where p ? 'team_code'
  ), 'projector carries no team code';
  assert (select count(distinct p ->> 'team_id')
          from jsonb_array_elements(board -> 'players') p) = 1,
    'both passports report the same team';
  assert position('challenge_score' in board::text) = 0, 'projector never exposes an internal team accumulator';
  assert (board -> 'stats' ->> 'top_score')::int = 41, 'projector top score is personal';

  console := admin_console('review-admin');
  assert (console -> 'stats' ->> 'top_score')::int = 41, 'admin top score is personal';

  raise notice 'PASS 12_single_score_event_review';
end $$;

rollback;
