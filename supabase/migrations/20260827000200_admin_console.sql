-- Life Passport — complete operations console.
-- Fixes API-safe session resets and exposes event/station/audit detail so the
-- admin UI can operate without opening Supabase Studio.

alter table game_archives
  add column if not exists life_event_count int not null default 0,
  add column if not exists tokens_used int not null default 0,
  add column if not exists station_metrics jsonb not null default '[]'::jsonb,
  add column if not exists activity jsonb not null default '[]'::jsonb,
  add column if not exists admin_log jsonb not null default '[]'::jsonb;

create or replace function _current_station_metrics()
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  with active as (
    select count(*)::numeric as count from players where not is_removed
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'slug', s.slug,
    'name_zh', s.name_zh,
    'type', s.type,
    'scoring_mode', s.scoring_mode,
    'sort_order', s.sort_order,
    'visits', case
      when s.type = 'main' then (select count(*) from attempts a join players p on p.id = a.player_id where a.station_id = s.id and a.status in ('passed','failed') and not p.is_removed)
      when s.type = 'life_event' then (select count(*) from life_events e join players p on p.id = e.player_id where not p.is_removed)
      else (select count(*) from token_usages t join players p on p.id = t.player_id where not p.is_removed)
    end,
    'passed', (select count(*) from attempts a join players p on p.id = a.player_id where a.station_id = s.id and a.status = 'passed' and not p.is_removed),
    'failed', (select count(*) from attempts a join players p on p.id = a.player_id where a.station_id = s.id and a.status = 'failed' and not p.is_removed),
    'score_awarded', coalesce((select sum(a.score) from attempts a join players p on p.id = a.player_id where a.station_id = s.id and a.status = 'passed' and not p.is_removed), 0),
    'completion_pct', case when s.type <> 'main' or active.count = 0 then 0 else round(
      (select count(distinct a.player_id)::numeric from attempts a join players p on p.id = a.player_id where a.station_id = s.id and a.status in ('passed','failed') and not p.is_removed)
      / active.count * 100, 1
    ) end
  ) order by s.sort_order), '[]'::jsonb)
  from stations s cross join active;
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
      select a.created_at as occurred_at, jsonb_build_object(
        'id', 'attempt-' || a.id, 'kind', 'attempt', 'at', a.created_at,
        'player_name', p.name, 'player_code', p.code,
        'label', s.name_zh,
        'detail', case when a.status = 'passed' then '+' || a.score || ' 分' else '挑战失败' end
      ) as item
      from attempts a join players p on p.id = a.player_id join stations s on s.id = a.station_id
      where a.status in ('passed','failed') and not p.is_removed
      union all
      select e.created_at, jsonb_build_object(
        'id', 'event-' || e.id, 'kind', 'life_event', 'at', e.created_at,
        'player_name', p.name, 'player_code', p.code,
        'label', '人生事件', 'detail', e.card_label
      )
      from life_events e join players p on p.id = e.player_id where not p.is_removed
      union all
      select t.created_at, jsonb_build_object(
        'id', 'token-' || t.id, 'kind', 'token', 'at', t.created_at,
        'player_name', p.name, 'player_code', p.code,
        'label', 'Help Token', 'detail', t.usage_type
      )
      from token_usages t join players p on p.id = t.player_id where not p.is_removed
      union all
      select aa.created_at, jsonb_build_object(
        'id', 'admin-' || aa.id, 'kind', 'admin', 'at', aa.created_at,
        'player_name', p.name, 'player_code', p.code,
        'label', '管理员操作', 'detail', coalesce(aa.reason, aa.action)
      )
      from admin_actions aa left join players p on p.id = aa.player_id
    ) all_activity
    order by occurred_at desc
    limit greatest(1, least(coalesce(p_limit, 40), 200))
  ) recent;
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
      ) order by a.created_at) from attempts a join stations s on s.id = a.station_id where a.player_id = p.id and a.status in ('passed','failed')), '[]'::jsonb),
      'life_events', coalesce((select jsonb_agg(jsonb_build_object(
        'card_type', e.card_type, 'card_label', e.card_label, 'score_before', e.score_before,
        'score_after', e.score_after, 'created_at', e.created_at
      ) order by e.created_at) from life_events e where e.player_id = p.id), '[]'::jsonb),
      'token_usages', coalesce((select jsonb_agg(jsonb_build_object(
        'usage_type', t.usage_type, 'target_station_id', t.target_station_id, 'created_at', t.created_at
      ) order by t.created_at) from token_usages t where t.player_id = p.id), '[]'::jsonb)
    ) order by p.score desc, p.created_at
  ), '[]'::jsonb)
  from players p;
$$;

create or replace function admin_console(p_admin_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state game_state;
begin
  perform _require_key('admin', p_admin_key);
  select * into v_state from game_state where id = 1;
  return jsonb_build_object(
    'current', _session_json(v_state),
    'stats', jsonb_build_object(
      'players', (select count(*) from players where not is_removed),
      'stamps', (select count(*) from attempts a join players p on p.id = a.player_id where not p.is_removed and a.status in ('passed','failed')),
      'life_events', (select count(*) from life_events e join players p on p.id = e.player_id where not p.is_removed),
      'tokens_used', (select count(*) from token_usages t join players p on p.id = t.player_id where not p.is_removed),
      'top_score', coalesce((select max(score) from players where not is_removed), 0),
      'locked_players', (select count(*) from players where not is_removed and locked_for_life_event),
      'removed_players', (select count(*) from players where is_removed)
    ),
    'station_metrics', _current_station_metrics(),
    'activity', _current_activity(50),
    'archives', coalesce((
      select jsonb_agg(jsonb_build_object(
        'event_id', source_event_id, 'title', title, 'phase', phase,
        'created_at', created_at, 'started_at', started_at, 'ended_at', ended_at,
        'player_count', player_count, 'top_score', top_score, 'stamps', stamps,
        'life_events', life_event_count, 'tokens_used', tokens_used
      ) order by archived_at desc)
      from game_archives
    ), '[]'::jsonb)
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
    return jsonb_build_object(
      'is_current', true,
      'session', _session_json(v_state),
      'players', _current_players_detail(),
      'station_metrics', _current_station_metrics(),
      'activity', _current_activity(200)
    );
  end if;

  select * into v_archive from game_archives where source_event_id = p_event_id;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  return jsonb_build_object(
    'is_current', false,
    'session', jsonb_build_object(
      'event_id', v_archive.source_event_id, 'title', v_archive.title,
      'phase', 'ended', 'join_open', false, 'created_at', v_archive.created_at,
      'started_at', v_archive.started_at, 'ended_at', v_archive.ended_at,
      'player_count', v_archive.player_count
    ),
    'players', v_archive.players,
    'station_metrics', v_archive.station_metrics,
    'activity', v_archive.activity,
    'admin_log', v_archive.admin_log
  );
end;
$$;

create or replace function admin_update_access(
  p_admin_key text,
  p_new_staff_key text default null,
  p_new_admin_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform _require_key('admin', p_admin_key);
  if p_new_staff_key is not null and (length(p_new_staff_key) < 6 or length(p_new_staff_key) > 64) then
    raise exception 'BAD_NEW_KEY';
  end if;
  if p_new_admin_key is not null and (length(p_new_admin_key) < 8 or length(p_new_admin_key) > 64) then
    raise exception 'BAD_NEW_KEY';
  end if;
  if p_new_staff_key is not null then
    update app_config set value = '{sha256}' || encode(extensions.digest(p_new_staff_key, 'sha256'), 'hex') where key = 'staff_key';
  end if;
  if p_new_admin_key is not null then
    update app_config set value = '{sha256}' || encode(extensions.digest(p_new_admin_key, 'sha256'), 'hex') where key = 'admin_key';
  end if;
  return jsonb_build_object('staff_key_changed', p_new_staff_key is not null, 'admin_key_changed', p_new_admin_key is not null);
end;
$$;

create or replace function admin_update_station(
  p_admin_key text,
  p_station_id int,
  p_name_zh text,
  p_scoring_mode text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_station stations;
  v_phase text;
  v_name text := trim(coalesce(p_name_zh, ''));
begin
  perform _require_key('admin', p_admin_key);
  select phase into v_phase from game_state where id = 1;
  if v_phase = 'playing' then raise exception 'GAME_IN_PROGRESS'; end if;
  if length(v_name) < 1 or length(v_name) > 30 then raise exception 'BAD_STATION_NAME'; end if;
  select * into v_station from stations where id = p_station_id;
  if not found then raise exception 'BAD_STATION'; end if;
  if v_station.type = 'main' and p_scoring_mode not in ('graded','fixed') then raise exception 'BAD_SCORING_MODE'; end if;
  update stations set name_zh = v_name,
    scoring_mode = case when type = 'main' then p_scoring_mode else null end
  where id = p_station_id returning * into v_station;
  return to_jsonb(v_station);
end;
$$;

-- Replaces the first session implementation. `pg_safeupdate` is enabled on
-- API connections and rejects DELETE without a WHERE clause, even inside a
-- security-definer function. Explicit `where true` keeps the intended bounded
-- tables clearable while satisfying that safety layer.
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
      station_metrics, activity, admin_log
    ) values (
      v_state.event_id, v_state.title, v_state.join_token, v_state.phase,
      v_state.created_at, v_state.started_at,
      coalesce(v_state.ended_at, case when v_state.phase = 'ended' then now() end),
      v_players,
      coalesce((select max(score) from players where not is_removed), 0),
      (select count(*) from attempts a join players p on p.id = a.player_id where not p.is_removed and a.status in ('passed','failed')),
      (select count(*) from life_events e join players p on p.id = e.player_id where not p.is_removed),
      (select count(*) from token_usages t join players p on p.id = t.player_id where not p.is_removed),
      _current_players_detail(), _current_station_metrics(), _current_activity(200),
      coalesce((select jsonb_agg(jsonb_build_object(
        'id', aa.id, 'action', aa.action, 'detail', aa.detail, 'reason', aa.reason,
        'player_name', p.name, 'player_code', p.code, 'created_at', aa.created_at
      ) order by aa.created_at desc) from admin_actions aa left join players p on p.id = aa.player_id), '[]'::jsonb)
    ) on conflict (source_event_id) do nothing;
  end if;

  delete from rpc_results where true;
  delete from admin_actions where true;
  delete from token_usages where true;
  delete from life_events where true;
  delete from attempts where true;
  delete from players where true;

  v_token := encode(extensions.gen_random_bytes(8), 'hex');
  update game_state set
    event_id = gen_random_uuid(), title = v_title, join_token = v_token,
    join_passphrase = '{sha256}' || encode(extensions.digest(v_token, 'sha256'), 'hex'),
    join_open = true, phase = 'waiting', created_at = now(),
    started_at = null, ended_at = null
  where id = 1 returning * into v_new;
  return _session_json(v_new);
end;
$$;

revoke execute on function _current_station_metrics(), _current_activity(int), _current_players_detail() from public, anon, authenticated;
grant execute on function
  admin_console(text),
  admin_event_detail(text, uuid),
  admin_update_access(text, text, text),
  admin_update_station(text, int, text, text)
to anon, authenticated;

