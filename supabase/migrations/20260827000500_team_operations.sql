-- Life Passport V2 — administration, projector and archive projections.

alter table game_archives add column if not exists teams jsonb not null default '[]'::jsonb;

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
    ) order by t.challenge_score desc, t.created_at
  ), '[]'::jsonb) from teams t;
$$;

create or replace function _current_players_detail()
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(
    _player_json(p.*) || jsonb_build_object(
      'is_removed', p.is_removed,
      'created_at', p.created_at,
      'attempt_count', (select count(*) from attempts a where a.player_id = p.id and a.status in ('passed','failed')),
      'attempts', coalesce((select jsonb_agg(jsonb_build_object(
        'station_id', a.station_id, 'station_name', s.name_zh, 'status', a.status,
        'score', a.score, 'created_at', a.created_at
      ) order by a.created_at) from attempts a join stations s on s.id = a.station_id
        where a.player_id = p.id and a.status in ('passed','failed')), '[]'::jsonb),
      'life_events', coalesce((select jsonb_agg(jsonb_build_object(
        'card_type', e.card_type, 'card_label', e.card_label,
        'scene_title', e.scene_title, 'choice_label', e.choice_label,
        'outcome_detail', e.outcome_detail,
        'score_before', e.score_before, 'score_after', e.score_after,
        'created_at', e.created_at
      ) order by e.created_at) from life_events e where e.player_id = p.id), '[]'::jsonb),
      'token_usages', coalesce((select jsonb_agg(jsonb_build_object(
        'usage_type', u.usage_type, 'target_station_id', u.target_station_id, 'created_at', u.created_at
      ) order by u.created_at) from token_usages u where u.player_id = p.id), '[]'::jsonb)
    ) order by p.score desc, p.created_at
  ), '[]'::jsonb) from players p;
$$;

create or replace function _current_station_metrics()
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  with active_teams as (select count(*)::numeric as count from teams)
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'slug', s.slug, 'name_zh', s.name_zh, 'type', s.type,
    'scoring_mode', s.scoring_mode, 'sort_order', s.sort_order,
    'visits', case
      when s.type = 'main' then
        (select count(*) from team_attempts a where a.station_id = s.id and a.status in ('passed','failed'))
        + (select count(*) from attempts a join players p on p.id = a.player_id
           where p.team_id is null and a.station_id = s.id and a.status in ('passed','failed') and not p.is_removed)
      when s.type = 'life_event' then (select count(*) from life_events)
      else (select count(*) from token_usages)
    end,
    'passed', (select count(*) from team_attempts a where a.station_id = s.id and a.status = 'passed'),
    'failed', (select count(*) from team_attempts a where a.station_id = s.id and a.status = 'failed'),
    'score_awarded', coalesce((select sum(a.score) from team_attempts a where a.station_id = s.id and a.status = 'passed'), 0),
    'completion_pct', case when s.type <> 'main' or active_teams.count = 0 then 0 else round(
      (select count(distinct a.team_id)::numeric from team_attempts a
       where a.station_id = s.id and a.status in ('passed','failed')) / active_teams.count * 100, 1)
    end
  ) order by s.sort_order), '[]'::jsonb)
  from stations s cross join active_teams;
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
        'player_name', coalesce((select string_agg(p.name, ' / ' order by p.created_at)
                                from players p where p.team_id = t.id and not p.is_removed), t.code),
        'player_code', t.code, 'label', s.name_zh,
        'detail', case when a.status = 'passed' then '+' || a.score || ' 同行积分' else '整队挑战失败' end
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
declare v_state game_state;
begin
  perform _require_key('admin', p_admin_key);
  select * into v_state from game_state where id = 1;
  return jsonb_build_object(
    'current', _session_json(v_state),
    'stats', jsonb_build_object(
      'players', (select count(*) from players where not is_removed),
      'teams', (select count(*) from teams),
      'stamps', (select count(*) from team_attempts where status in ('passed','failed')),
      'life_events', (select count(*) from life_events),
      'tokens_used', (select count(*) from token_usages),
      'top_score', coalesce((select max(challenge_score) from teams), 0),
      'top_personal_score', coalesce((select max(score) from players where not is_removed), 0),
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

create or replace function admin_event_detail(p_admin_key text, p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state game_state;
  v_archive game_archives;
begin
  perform _require_key('admin', p_admin_key);
  select * into v_state from game_state where id = 1;
  if v_state.event_id = p_event_id then
    return jsonb_build_object('is_current', true, 'session', _session_json(v_state),
      'players', _current_players_detail(), 'teams', _current_teams_detail(),
      'station_metrics', _current_station_metrics(), 'activity', _current_activity(200));
  end if;
  select * into v_archive from game_archives where source_event_id = p_event_id;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  return jsonb_build_object(
    'is_current', false,
    'session', jsonb_build_object('event_id', v_archive.source_event_id,
      'title', v_archive.title, 'phase', 'ended', 'join_open', false,
      'created_at', v_archive.created_at, 'started_at', v_archive.started_at,
      'ended_at', v_archive.ended_at, 'player_count', v_archive.player_count),
    'players', v_archive.players, 'teams', v_archive.teams,
    'station_metrics', v_archive.station_metrics, 'activity', v_archive.activity,
    'admin_log', v_archive.admin_log
  );
end;
$$;

-- Full session reset, ordered around the new foreign keys. The archive keeps
-- both personal passports and team standings.
create or replace function admin_create_game(
  p_admin_key text,
  p_title text,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state game_state;
  v_title text := trim(coalesce(p_title, ''));
  v_players int;
  v_token text;
  v_new game_state;
begin
  perform _require_key('admin', p_admin_key);
  if length(v_title) < 1 or length(v_title) > 60 then raise exception 'BAD_GAME_TITLE'; end if;
  select * into v_state from game_state where id = 1 for update;
  select count(*) into v_players from players where not is_removed;
  if (v_state.phase <> 'ended' and v_players > 0) and not p_force then raise exception 'ACTIVE_GAME_EXISTS'; end if;

  if v_players > 0 or v_state.phase <> 'waiting' then
    insert into game_archives (
      source_event_id, title, join_token, phase, created_at, started_at, ended_at,
      player_count, top_score, stamps, life_event_count, tokens_used, players,
      teams, station_metrics, activity, admin_log
    ) values (
      v_state.event_id, v_state.title, v_state.join_token, v_state.phase,
      v_state.created_at, v_state.started_at,
      coalesce(v_state.ended_at, case when v_state.phase = 'ended' then now() end),
      v_players, coalesce((select max(challenge_score) from teams), 0),
      (select count(*) from team_attempts where status in ('passed','failed')),
      (select count(*) from life_events), (select count(*) from token_usages),
      _current_players_detail(), _current_teams_detail(), _current_station_metrics(),
      _current_activity(200), coalesce((select jsonb_agg(jsonb_build_object(
        'id', aa.id, 'action', aa.action, 'detail', aa.detail, 'reason', aa.reason,
        'player_name', p.name, 'player_code', p.code, 'created_at', aa.created_at
      ) order by aa.created_at desc) from admin_actions aa left join players p on p.id = aa.player_id), '[]'::jsonb)
    ) on conflict (source_event_id) do nothing;
  end if;

  delete from rpc_results where true;
  delete from admin_actions where true;
  delete from token_usages where true;
  delete from life_events where true;
  delete from life_event_instances where true;
  delete from attempts where true;
  delete from team_attempts where true;
  delete from players where true;
  delete from teams where true;

  v_token := encode(extensions.gen_random_bytes(8), 'hex');
  update game_state set event_id = gen_random_uuid(), title = v_title,
    join_token = v_token,
    join_passphrase = '{sha256}' || encode(extensions.digest(v_token, 'sha256'), 'hex'),
    join_open = true, phase = 'waiting', created_at = now(),
    started_at = null, ended_at = null
  where id = 1 returning * into v_new;
  return _session_json(v_new);
end;
$$;

create or replace function admin_adjust(
  p_admin_key text,
  p_player_code text,
  p_new_score int default null,
  p_unlock boolean default false,
  p_clear_effect boolean default false,
  p_restore_token boolean default false,
  p_restore boolean default false,
  p_new_next_threshold int default -1,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_player players;
  v_after players;
begin
  perform _require_key('admin', p_admin_key);
  select * into v_player from players where code = p_player_code for update;
  if not found then raise exception 'PLAYER_NOT_FOUND:%', p_player_code; end if;
  if p_unlock then
    update life_event_instances set state = 'cancelled', resolved_at = clock_timestamp()
    where player_id = v_player.id and state = 'pending';
  end if;
  update players set
    score = coalesce(p_new_score, score),
    locked_for_life_event = case when p_unlock then false else locked_for_life_event end,
    pending_threshold = case when p_unlock then null else pending_threshold end,
    status_effect = case when p_clear_effect then null else status_effect end,
    token_available = case when p_restore_token then true else token_available end,
    is_removed = case when p_restore then false else is_removed end,
    next_threshold = case when p_new_next_threshold = -1 then next_threshold
      when p_new_next_threshold = 0 then null else p_new_next_threshold end
  where id = v_player.id returning * into v_after;
  insert into admin_actions (player_id, action, detail, reason)
  values (v_player.id, 'adjust', jsonb_build_object('before', _player_json(v_player),
          'after', _player_json(v_after)), p_reason);
  return _player_json(v_after);
end;
$$;

-- Team standings for the projector. Personal event results stay in the feed,
-- but never rewrite the competitive ranking.
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
    'players', coalesce((
      select jsonb_agg(row_json order by score desc, created_at) from (
        select t.challenge_score score, t.created_at,
          jsonb_build_object(
            'id', t.id, 'name', coalesce(string_agg(p.name, ' / ' order by p.created_at) filter (where not p.is_removed), t.code),
            'team_code', t.code, 'member_count', count(p.id) filter (where not p.is_removed),
            'identity', t.identity, 'color_group', t.color_group,
            'score', t.challenge_score,
            'locked', bool_or(p.locked_for_life_event) filter (where not p.is_removed),
            'token_available', bool_and(p.token_available) filter (where not p.is_removed),
            'sick', false,
            'stations_done', (select count(*) from team_attempts a where a.team_id = t.id and a.status in ('passed','failed'))
          ) row_json
        from teams t left join players p on p.team_id = t.id
        group by t.id
        union all
        select p.score, p.created_at, jsonb_build_object(
          'id', p.id, 'name', p.name, 'team_code', null, 'member_count', 1,
          'identity', p.identity, 'color_group', p.color_group, 'score', p.score,
          'locked', p.locked_for_life_event, 'token_available', p.token_available,
          'sick', (p.status_effect ->> 'type') = 'cap_next',
          'stations_done', (select count(*) from attempts a where a.player_id = p.id and a.status in ('passed','failed'))
        ) from players p where p.team_id is null and not p.is_removed
      ) board_rows
    ), '[]'::jsonb),
    'stats', jsonb_build_object(
      'players', (select count(*) from players where not is_removed),
      'teams', (select count(*) from teams),
      'stamps', (select count(*) from team_attempts where status in ('passed','failed'))
        + (select count(*) from attempts a join players p on p.id = a.player_id
           where p.team_id is null and not p.is_removed and a.status in ('passed','failed')),
      'life_events', (select count(*) from life_events),
      'tokens_used', (select count(*) from token_usages),
      'top_score', greatest(coalesce((select max(challenge_score) from teams), 0),
                            coalesce((select max(score) from players where team_id is null and not is_removed), 0))
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
          'name', coalesce((select string_agg(p.name, ' / ' order by p.created_at)
                            from players p where p.team_id = t.id and not p.is_removed), t.code),
          'station', s.name_zh, 'status', a.status, 'score', a.score,
          'total', t.challenge_score, 'at', a.created_at
        ) from team_attempts a join teams t on t.id = a.team_id join stations s on s.id = a.station_id
          where a.status in ('passed','failed')
        union all
        select a.created_at, jsonb_build_object(
          'id', 'a' || a.id, 'kind', 'attempt', 'name', p.name,
          'station', s.name_zh, 'status', a.status, 'score', a.score,
          'total', p.score, 'at', a.created_at
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

revoke execute on function _current_teams_detail() from public, anon, authenticated;
grant execute on function board_snapshot(), admin_console(text),
  admin_event_detail(text, uuid), admin_create_game(text, text, boolean)
to anon, authenticated;

