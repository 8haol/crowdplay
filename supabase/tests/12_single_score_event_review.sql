-- V2.1 regression: one public score and a complete admin-only event audit.
begin;
delete from events; delete from organizations;
insert into organizations (slug, name_zh, name_en, admin_key) values ('tc', '测试教会', 'Test Church', 'test-admin');
insert into events (org_id, title, join_token, staff_code, screen_token, phase, started_at)
select id, '测试场', 'join-t', 'STAFF1', 'screen-t', 'playing', now() from organizations where slug = 'tc';

do $$
declare
  v_ev uuid := (select id from events where join_token = 'join-t');
  v_team uuid;
  catalog jsonb; board jsonb; console jsonb;
  rejected boolean := false;
begin
  begin
    perform admin_life_event_catalog('wrong-key');
  exception when others then
    rejected := true;
  end;
  assert rejected, 'event catalog rejects a wrong admin key';

  catalog := admin_life_event_catalog('test-admin');
  -- 30 shared scenes + 15 midautumn ones (20260922000100_theme_scenes.sql)
  assert (catalog -> 'stats' ->> 'scenes')::int = 45, 'all 45 scenes are available for review';
  assert (catalog -> 'stats' ->> 'choices')::int = 90, 'every scene exposes both actions';
  assert (catalog -> 'stats' ->> 'outcomes')::int = 270, 'all three random outcomes per action are visible';
  assert catalog -> 'stats' -> 'by_audience' = '{"all":21,"solo":8,"duo":8,"trio":8}'::jsonb, 'audience counts are complete';
  assert catalog -> 'stats' -> 'by_theme' = '{"shared":30,"midautumn":15}'::jsonb, 'theme counts are complete';
  assert not has_table_privilege('anon', 'life_event_scenes', 'select'), 'players cannot read the hidden result table directly';
  assert life_event_library() = catalog, 'the public library and the admin audit return one identical payload';
  assert has_function_privilege('anon', 'life_event_library()', 'execute'), 'volunteers can open the library without a password';
  assert not has_function_privilege('anon', '_life_event_catalog_json()', 'execute'), 'the shared helper stays internal';

  insert into teams (event_id, code, identity, color_group, challenge_score) values (v_ev, 'D01', 'duo', 'blue', 99) returning id into v_team;
  insert into players (event_id, name, code, identity, color_group, team_id, score) values
    (v_ev, '高分玩家', '921', 'duo', 'blue', v_team, 41), (v_ev, '事件后玩家', '922', 'duo', 'blue', v_team, 17);

  board := board_snapshot('screen-t');
  assert exists (select 1 from jsonb_array_elements(board -> 'players') p where p ->> 'name' = '高分玩家' and (p ->> 'score')::int = 41), 'projector shows the personal score';
  assert not exists (select 1 from jsonb_array_elements(board -> 'players') p where p ? 'team_code'), 'projector carries no team code';
  assert (select count(distinct p ->> 'team_id') from jsonb_array_elements(board -> 'players') p) = 1, 'both passports report the same team';
  assert position('challenge_score' in board::text) = 0, 'projector never exposes the internal team accumulator';
  assert (board -> 'stats' ->> 'top_score')::int = 41, 'projector top score is personal';

  console := admin_console('test-admin', v_ev);
  assert (console -> 'stats' ->> 'top_score')::int = 41, 'admin top score is personal';

  raise notice 'PASS 12_single_score_event_review';
end $$;
rollback;
