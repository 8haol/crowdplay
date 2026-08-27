-- Life Passport V2.1 — one visible personal score and a protected event audit.
-- `teams.challenge_score` remains an internal station-operation accumulator so
-- retries and historic migrations stay compatible; it is no longer a player,
-- admin or projector score.

create or replace function _current_teams_detail()
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(
    _team_json(t.id) || jsonb_build_object(
      'stations_done', (select count(*) from team_attempts a where a.team_id = t.id and a.status in ('passed','failed')),
      'pending_events', (select count(*) from players p where p.team_id = t.id and not p.is_removed and p.locked_for_life_event),
      'created_at', t.created_at
    ) order by t.code
  ), '[]'::jsonb) from teams t;
$$;

create or replace function _current_activity(p_limit int default 40)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(item order by occurred_at desc), '[]'::jsonb)
  from (
    select occurred_at, item from (
      select a.created_at occurred_at, jsonb_build_object(
        'id', 'team-attempt-' || a.id, 'kind', 'attempt', 'at', a.created_at,
        'player_name', t.code || ' · ' || coalesce((select string_agg(p.name, ' / ' order by p.created_at)
                                from players p where p.team_id = t.id and not p.is_removed), t.code),
        'player_code', t.code, 'label', s.name_zh,
        'detail', case when a.status = 'passed' then '全队每人 +' || a.score || ' 分' else '本队本次未得分' end
      ) item
      from team_attempts a join teams t on t.id = a.team_id join stations s on s.id = a.station_id
      where a.status in ('passed','failed')
      union all
      select e.created_at, jsonb_build_object(
        'id', 'event-' || e.id, 'kind', 'life_event', 'at', e.created_at,
        'player_name', p.name, 'player_code', p.code,
        'label', coalesce(e.scene_title, '人生事件'), 'detail', e.card_label
      ) from life_events e join players p on p.id = e.player_id where not p.is_removed
      union all
      select u.created_at, jsonb_build_object(
        'id', 'token-' || u.id, 'kind', 'token', 'at', u.created_at,
        'player_name', p.name, 'player_code', p.code,
        'label', 'Help Token', 'detail', u.usage_type
      ) from token_usages u join players p on p.id = u.player_id where not p.is_removed
      union all
      select aa.created_at, jsonb_build_object(
        'id', 'admin-' || aa.id, 'kind', 'admin', 'at', aa.created_at,
        'player_name', p.name, 'player_code', p.code,
        'label', '管理员操作', 'detail', coalesce(aa.reason, aa.action)
      ) from admin_actions aa left join players p on p.id = aa.player_id
    ) activity_union order by occurred_at desc
    limit greatest(1, least(coalesce(p_limit, 40), 200))
  ) recent;
$$;

create or replace function admin_console(p_admin_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state game_state;
  v_top int;
begin
  perform _require_key('admin', p_admin_key);
  select * into v_state from game_state where id = 1;
  select coalesce(max(score), 0) into v_top from players where not is_removed;
  return jsonb_build_object(
    'current', _session_json(v_state),
    'stats', jsonb_build_object(
      'players', (select count(*) from players where not is_removed),
      'teams', (select count(*) from teams),
      'stamps', (select count(*) from team_attempts where status in ('passed','failed')),
      'life_events', (select count(*) from life_events),
      'tokens_used', (select count(*) from token_usages),
      'top_score', v_top,
      'top_personal_score', v_top,
      'locked_players', (select count(*) from players where not is_removed and locked_for_life_event),
      'removed_players', (select count(*) from players where is_removed)
    ),
    'teams', _current_teams_detail(),
    'station_metrics', _current_station_metrics(),
    'activity', _current_activity(50),
    'archives', coalesce((select jsonb_agg(jsonb_build_object(
      'event_id', source_event_id, 'title', title, 'phase', phase,
      'created_at', created_at, 'started_at', started_at, 'ended_at', ended_at,
      'player_count', player_count, 'top_score', top_score, 'stamps', stamps,
      'life_events', life_event_count, 'tokens_used', tokens_used
    ) order by archived_at desc) from game_archives), '[]'::jsonb)
  );
end;
$$;

-- Archive summaries also use the highest personal passport score.
create or replace function _archive_set_personal_top()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  select coalesce(max((entry ->> 'score')::int), 0) into new.top_score
  from jsonb_array_elements(coalesce(new.players, '[]'::jsonb)) entry
  where coalesce((entry ->> 'is_removed')::boolean, false) = false;
  return new;
end;
$$;

drop trigger if exists game_archives_personal_top on game_archives;
create trigger game_archives_personal_top
before insert or update of players, top_score on game_archives
for each row execute function _archive_set_personal_top();

update game_archives set top_score = top_score;

-- Public projector: one row per passport, ordered by that player's total.
create or replace function board_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_state game_state;
begin
  select * into v_state from game_state where id = 1;
  return jsonb_build_object(
    'phase', v_state.phase, 'started_at', v_state.started_at,
    'players', coalesce((select jsonb_agg(row_json order by score desc, created_at) from (
      select p.score, p.created_at, jsonb_build_object(
        'id', p.id, 'name', p.name, 'team_code', t.code,
        'member_count', (select count(*) from players m where m.team_id = p.team_id and not m.is_removed),
        'identity', p.identity, 'color_group', p.color_group, 'score', p.score,
        'locked', p.locked_for_life_event, 'token_available', p.token_available,
        'sick', (p.status_effect ->> 'type') = 'cap_next',
        'stations_done', (select count(*) from attempts a where a.player_id = p.id and a.status in ('passed','failed'))
      ) row_json
      from players p left join teams t on t.id = p.team_id
      where not p.is_removed
    ) personal_board), '[]'::jsonb),
    'stats', jsonb_build_object(
      'players', (select count(*) from players where not is_removed),
      'teams', (select count(*) from teams),
      'stamps', (select count(*) from team_attempts where status in ('passed','failed'))
        + (select count(*) from attempts a join players p on p.id = a.player_id
           where p.team_id is null and not p.is_removed and a.status in ('passed','failed')),
      'life_events', (select count(*) from life_events),
      'tokens_used', (select count(*) from token_usages),
      'top_score', coalesce((select max(score) from players where not is_removed), 0)
    ),
    'feed', coalesce((select jsonb_agg(item order by created_at desc) from (
      select created_at, item from (
        select e.created_at, jsonb_build_object(
          'id', 'e' || e.id, 'kind', 'life_event', 'name', p.name,
          'card', e.card_type, 'label', coalesce(e.scene_title || ' · ', '') || e.card_label,
          'threshold', e.threshold, 'before', e.score_before, 'after', e.score_after, 'at', e.created_at
        ) item from life_events e join players p on p.id = e.player_id where not p.is_removed
        union all
        select a.created_at, jsonb_build_object(
          'id', 'ta' || a.id, 'kind', 'attempt',
          'name', t.code || ' · ' || coalesce((select string_agg(p.name, ' / ' order by p.created_at)
                            from players p where p.team_id = t.id and not p.is_removed), t.code),
          'station', s.name_zh, 'status', a.status, 'score', a.score, 'at', a.created_at
        ) from team_attempts a join teams t on t.id = a.team_id join stations s on s.id = a.station_id
          where a.status in ('passed','failed')
        union all
        select a.created_at, jsonb_build_object(
          'id', 'a' || a.id, 'kind', 'attempt', 'name', p.name,
          'station', s.name_zh, 'status', a.status, 'score', a.score, 'at', a.created_at
        ) from attempts a join players p on p.id = a.player_id join stations s on s.id = a.station_id
          where p.team_id is null and not p.is_removed and a.status in ('passed','failed')
        union all
        select u.created_at, jsonb_build_object(
          'id', 'u' || u.id, 'kind', 'token', 'name', p.name,
          'usage', u.usage_type, 'station', s.name_zh, 'at', u.created_at
        ) from token_usages u join players p on p.id = u.player_id
          left join stations s on s.id = u.target_station_id where not p.is_removed
      ) feed_union order by created_at desc limit 60
    ) recent), '[]'::jsonb)
  );
end;
$$;

-- Admin-only content audit. Choices and hidden outcomes are intentionally
-- returned here, never from poll_player or the public board.
create or replace function admin_life_event_catalog(p_admin_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform _require_key('admin', p_admin_key);
  return jsonb_build_object(
    'stats', jsonb_build_object(
      'scenes', (select count(*) from life_event_scenes where active),
      'choices', (select coalesce(sum(jsonb_array_length(choices)), 0) from life_event_scenes where active),
      'outcomes', (select count(*) from life_event_scenes s
        cross join lateral jsonb_array_elements(s.choices) choice
        cross join lateral jsonb_array_elements(choice -> 'outcomes') outcome where s.active),
      'by_audience', jsonb_build_object(
        'all', (select count(*) from life_event_scenes where active and audience = 'all'),
        'solo', (select count(*) from life_event_scenes where active and audience = 'solo'),
        'duo', (select count(*) from life_event_scenes where active and audience = 'duo'),
        'trio', (select count(*) from life_event_scenes where active and audience = 'trio')
      )
    ),
    'scenes', coalesce((select jsonb_agg(jsonb_build_object(
      'key', key, 'audience', audience, 'title', title, 'prompt', prompt,
      'emoji', emoji, 'choices', choices, 'active', active, 'sort_order', sort_order
    ) order by sort_order, key) from life_event_scenes), '[]'::jsonb)
  );
end;
$$;

-- Add rare, visibly auditable extremes without making a chosen action
-- deterministic. Their weights stay low relative to the other outcomes.
update life_event_scenes
set choices = jsonb_set(
  jsonb_set(
    jsonb_set(
    jsonb_set(
      jsonb_set(choices, '{0,outcomes,2,label}', to_jsonb('所有备份都失效'::text)),
      '{0,outcomes,2,detail}', to_jsonb('文件彻底损坏，这次打击让你的当前总分减半。'::text)),
    '{0,outcomes,2,delta}', '0'::jsonb),
    '{0,outcomes,2,multiplier}', '50'::jsonb),
  '{0,outcomes,2,weight}', '10'::jsonb)
where key = 'all_file_crash';

update life_event_scenes
set choices = jsonb_set(
  jsonb_set(
    jsonb_set(
    jsonb_set(
      jsonb_set(choices, '{1,outcomes,0,label}', to_jsonb('陌生环境带来人生跃迁'::text)),
      '{1,outcomes,0,detail}', to_jsonb('这次冒险远超预期，你的当前总分获得 1.5 倍放大。'::text)),
    '{1,outcomes,0,delta}', '0'::jsonb),
    '{1,outcomes,0,multiplier}', '150'::jsonb),
  '{1,outcomes,0,weight}', '10'::jsonb)
where key = 'all_crossroads';

grant execute on function board_snapshot(), admin_console(text), admin_life_event_catalog(text)
to anon, authenticated;
revoke execute on function _archive_set_personal_top() from public, anon, authenticated;
