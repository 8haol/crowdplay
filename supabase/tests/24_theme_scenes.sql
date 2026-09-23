-- supabase/tests/24_theme_scenes.sql
-- Tests: theme-specific life-event scenes — midautumn events draw only their own scenes,
-- passport events never see them, exhausted packs fall back, catalog carries theme, balance rules hold.
begin;
delete from events; delete from organizations;
insert into organizations (slug, name_zh, name_en, admin_key) values ('tc', '测试教会', 'Test Church', 'test-admin');
insert into events (org_id, title, theme, join_token, staff_code, screen_token, phase, started_at)
select id, '中秋场', 'midautumn', 'join-ma', 'STAFF1', 'screen-ma', 'playing', now() from organizations where slug = 'tc';
insert into events (org_id, title, theme, join_token, staff_code, screen_token, phase, started_at)
select id, '护照场', 'passport', 'join-pp', 'STAFF2', 'screen-pp', 'playing', now() from organizations where slug = 'tc';

-- Walk one player through all three stages, choosing the first action each time,
-- and return the scene keys drawn in order.
create function pg_temp.walk_three_stages(p_join text, p_code text, p_player uuid)
returns text[] language plpgsql as $$
declare
  v_inst uuid; v_keys text[] := '{}'; v_gate int;
begin
  foreach v_gate in array array[15, 35, 45] loop
    update players set score = v_gate where id = p_player;
    v_inst := _sync_life_event(p_player);
    assert v_inst is not null, format('gate %s opens a stage for %s', v_gate, p_code);
    v_keys := v_keys || (select scene_key from life_event_instances where id = v_inst);
    perform choose_life_event_by_link(p_join, p_code, v_inst,
      (select scene_snapshot -> 'choices' -> 0 ->> 'key' from life_event_instances where id = v_inst),
      'idem-' || p_code || '-' || v_gate);
  end loop;
  return v_keys;
end;
$$;

do $$
declare
  v_ma uuid := (select id from events where join_token = 'join-ma');
  v_pp uuid := (select id from events where join_token = 'join-pp');
  t uuid; p uuid; keys text[]; k text; catalog jsonb; scene jsonb; choice jsonb;
  v_pos int; v_nonpos int; v_bad_tone int;
begin
  -- 1. midautumn event: solo / duo / trio players all draw ma_ scenes at every stage
  t := _make_team(v_ma, 'solo', 'solo-1');
  insert into players (event_id, name, code, identity, color_group, team_id) values (v_ma, '独行', '101', 'solo', 'solo-1', t) returning id into p;
  keys := pg_temp.walk_three_stages('join-ma', '101', p);
  assert array_length(keys, 1) = 3, 'solo walked three stages';
  foreach k in array keys loop assert k like 'ma\_%', 'midautumn solo drew ' || k; end loop;

  t := _make_team(v_ma, 'duo', 'red');
  insert into players (event_id, name, code, identity, color_group, team_id) values (v_ma, '双人甲', '102', 'duo', 'red', t) returning id into p;
  keys := pg_temp.walk_three_stages('join-ma', '102', p);
  foreach k in array keys loop assert k like 'ma\_%', 'midautumn duo drew ' || k; end loop;

  t := _make_team(v_ma, 'trio', 'teal');
  insert into players (event_id, name, code, identity, color_group, team_id) values (v_ma, '三人甲', '103', 'trio', 'teal', t) returning id into p;
  keys := pg_temp.walk_three_stages('join-ma', '103', p);
  foreach k in array keys loop assert k like 'ma\_%', 'midautumn trio drew ' || k; end loop;

  -- 2. passport event never sees a midautumn scene
  t := _make_team(v_pp, 'solo', 'solo-1');
  insert into players (event_id, name, code, identity, color_group, team_id) values (v_pp, '护照客', '201', 'solo', 'solo-1', t) returning id into p;
  keys := pg_temp.walk_three_stages('join-pp', '201', p);
  foreach k in array keys loop assert k not like 'ma\_%', 'passport player drew ' || k; end loop;

  -- 3. pack exhausted → fall back to the shared library instead of failing
  update life_event_scenes set active = false where theme = 'midautumn';
  t := _make_team(v_ma, 'solo', 'solo-2');
  insert into players (event_id, name, code, identity, color_group, team_id) values (v_ma, '晚到', '104', 'solo', 'solo-2', t) returning id into p;
  keys := pg_temp.walk_three_stages('join-ma', '104', p);
  foreach k in array keys loop assert k not like 'ma\_%', 'exhausted pack fell back, drew ' || k; end loop;
  update life_event_scenes set active = true where theme = 'midautumn';

  -- 4. catalog carries theme
  catalog := life_event_library();
  assert (catalog -> 'stats' -> 'by_theme' ->> 'midautumn')::int = 15, 'by_theme.midautumn = 15';
  assert (catalog -> 'stats' -> 'by_theme' ->> 'shared')::int = 30, 'by_theme.shared = 30';
  for scene in select value from jsonb_array_elements(catalog -> 'scenes') loop
    assert scene ? 'theme', 'scene payload has theme key: ' || (scene ->> 'key');
    if scene ->> 'key' like 'ma\_%' then
      assert scene ->> 'theme' = 'midautumn', 'ma_ scene is midautumn: ' || (scene ->> 'key');
    else
      assert scene -> 'theme' = 'null'::jsonb, 'legacy scene is shared: ' || (scene ->> 'key');
    end if;
  end loop;

  -- 5. every new scene obeys the balance rules: 2 actions × 3 outcomes,
  --    positive weight ≤ 40, non-positive ≥ 60, tone matches delta sign
  for scene in select to_jsonb(s) from life_event_scenes s where theme = 'midautumn' loop
    assert jsonb_array_length(scene -> 'choices') = 2, 'two actions: ' || (scene ->> 'key');
    for choice in select value from jsonb_array_elements(scene -> 'choices') loop
      assert jsonb_array_length(choice -> 'outcomes') = 3, 'three outcomes: ' || (scene ->> 'key') || '/' || (choice ->> 'key');
      select
        coalesce(sum((o ->> 'weight')::int) filter (where (o ->> 'delta')::int > 0), 0),
        coalesce(sum((o ->> 'weight')::int) filter (where (o ->> 'delta')::int <= 0), 0),
        count(*) filter (where
          ((o ->> 'delta')::int > 0 and o ->> 'tone' <> 'good') or
          ((o ->> 'delta')::int = 0 and o ->> 'tone' <> 'neutral') or
          ((o ->> 'delta')::int < 0 and o ->> 'tone' <> 'bad'))
      into v_pos, v_nonpos, v_bad_tone
      from jsonb_array_elements(choice -> 'outcomes') o;
      assert v_pos <= 40, format('positive weight %s ≤ 40: %s/%s', v_pos, scene ->> 'key', choice ->> 'key');
      assert v_nonpos >= 60, format('non-positive weight %s ≥ 60: %s/%s', v_nonpos, scene ->> 'key', choice ->> 'key');
      assert v_bad_tone = 0, format('tone matches delta: %s/%s', scene ->> 'key', choice ->> 'key');
    end loop;
  end loop;

  -- 5b. solo players draw audience = 'all' scenes too, so those never mention teammates;
  --     theme scenes are shared across orgs, so none names a venue
  assert not exists (select 1 from life_event_scenes s
    where s.theme = 'midautumn' and s.audience = 'all'
      and (s.prompt || s.choices::text) ~ '队友|队伍'), 'all-audience ma_ scenes mention no teammates';
  assert not exists (select 1 from life_event_scenes s
    where s.theme = 'midautumn' and (s.title || s.prompt || s.choices::text) ~* 'soho'), 'ma_ scenes name no venue';

  -- 6. theme column is validated
  begin
    insert into life_event_scenes (key, audience, theme, title, prompt, choices) values ('bad', 'all', 'halloween', 'x', 'y', '[]');
    raise exception 'TEST FAILED: expected check violation';
  exception when check_violation then null;
  end;

  raise notice 'theme scenes OK';
end $$;
rollback;
