-- Life Passport — repeatable game sessions and QR-first admission.
--
-- The original app kept one permanent global game. Once it reached `ended`,
-- every old bookmark could only see the finished state and operators had to
-- reset data by hand in Supabase. This migration keeps the proven single-live-
-- game logic, but adds a first-class lifecycle around it:
--   * one current session with an unguessable join link
--   * archived snapshots for previous sessions
--   * admin RPCs for creating and editing sessions
--   * link-scoped player RPCs so an old link can never enter a new session

alter table game_state
  add column if not exists event_id uuid not null default gen_random_uuid(),
  add column if not exists title text not null default 'Life Passport 迎新会',
  add column if not exists join_token text,
  add column if not exists join_open boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists ended_at timestamptz;

update game_state
set join_token = encode(extensions.gen_random_bytes(8), 'hex')
where join_token is null;

alter table game_state alter column join_token set not null;
create unique index if not exists game_state_join_token_key on game_state (join_token);

-- A legacy game may already be ended when this migration is installed.
-- Keep its public admission state consistent with the finished phase.
update game_state set join_open = false where phase = 'ended';

-- The passphrase column is retained for compatibility with the original
-- schema, but now stores the hash of the link token. No typed passphrase is
-- exposed in the product.
update game_state
set join_passphrase = '{sha256}' || encode(extensions.digest(join_token, 'sha256'), 'hex');

create table game_archives (
  id uuid primary key default gen_random_uuid(),
  source_event_id uuid not null unique,
  title text not null,
  join_token text not null unique,
  phase text not null check (phase in ('waiting', 'playing', 'ended')),
  created_at timestamptz not null,
  started_at timestamptz,
  ended_at timestamptz,
  player_count int not null default 0,
  top_score int not null default 0,
  stamps int not null default 0,
  players jsonb not null default '[]'::jsonb,
  archived_at timestamptz not null default now()
);

alter table game_archives enable row level security;
revoke all on game_archives from public, anon, authenticated;

create or replace function _session_json(p_state game_state)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'event_id', p_state.event_id,
    'title', p_state.title,
    'join_token', p_state.join_token,
    'join_open', p_state.join_open,
    'phase', p_state.phase,
    'created_at', p_state.created_at,
    'started_at', p_state.started_at,
    'ended_at', p_state.ended_at,
    'player_count', (select count(*) from players where not is_removed)
  );
$$;

-- Public landing metadata. Passing null returns the current session so the
-- home page can route guests who did not arrive through the QR code. Passing
-- a token returns either the current session or a deliberately minimal archive
-- record. Player codes and results never appear here.
create or replace function game_landing(p_join_token text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state game_state;
  v_archive game_archives;
begin
  select * into v_state from game_state where id = 1;

  if p_join_token is null or p_join_token = '' or p_join_token = v_state.join_token then
    return _session_json(v_state) || jsonb_build_object('is_current', true);
  end if;

  select * into v_archive from game_archives where join_token = p_join_token;
  if found then
    return jsonb_build_object(
      'event_id', v_archive.source_event_id,
      'title', v_archive.title,
      'join_token', v_archive.join_token,
      'join_open', false,
      'phase', 'ended',
      'created_at', v_archive.created_at,
      'started_at', v_archive.started_at,
      'ended_at', v_archive.ended_at,
      'player_count', v_archive.player_count,
      'is_current', false,
      'current_join_token', v_state.join_token,
      'current_title', v_state.title,
      'current_phase', v_state.phase,
      'current_join_open', v_state.join_open
    );
  end if;

  return jsonb_build_object(
    'is_current', false,
    'invalid', true,
    'current_join_token', v_state.join_token,
    'current_title', v_state.title,
    'current_phase', v_state.phase,
    'current_join_open', v_state.join_open
  );
end;
$$;

create or replace function join_by_link(p_name text, p_join_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state game_state;
  v_name text := trim(coalesce(p_name, ''));
  v_code text;
  v_id uuid;
  v_solo_group text;
  i int;
begin
  select * into v_state from game_state where id = 1 for update;
  if p_join_token is distinct from v_state.join_token then
    if exists (select 1 from game_archives where join_token = p_join_token) then
      raise exception 'GAME_ARCHIVED';
    end if;
    raise exception 'BAD_GAME_LINK';
  end if;
  if not v_state.join_open then raise exception 'JOIN_CLOSED'; end if;
  if v_state.phase = 'ended' then raise exception 'GAME_ARCHIVED'; end if;
  if length(v_name) < 1 or length(v_name) > 20 then raise exception 'BAD_NAME'; end if;

  for i in 1..100 loop
    v_code := lpad((floor(random() * 9999) + 1)::int::text, 4, '0');
    begin
      v_solo_group := case when v_state.phase = 'playing'
        then 'solo-' || ((select count(*) from players where identity = 'solo') + 1)::text
        else null end;
      insert into players (name, code, identity, color_group)
      values (v_name, v_code,
              case when v_state.phase = 'playing' then 'solo' end,
              v_solo_group)
      returning id into v_id;
      return jsonb_build_object(
        'player_id', v_id,
        'code', v_code,
        'event_id', v_state.event_id,
        'title', v_state.title
      );
    exception when unique_violation then
      -- code collision, retry
    end;
  end loop;
  raise exception 'CODE_POOL_EXHAUSTED';
end;
$$;

create or replace function recover_by_link(p_join_token text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state game_state;
  v players;
begin
  select * into v_state from game_state where id = 1;
  if p_join_token is distinct from v_state.join_token then
    if exists (select 1 from game_archives where join_token = p_join_token) then
      raise exception 'GAME_ARCHIVED';
    end if;
    raise exception 'BAD_GAME_LINK';
  end if;
  select * into v from players where code = p_code and not is_removed;
  if not found then
    perform _throttle_failed_attempt('recover_identity');
    raise exception 'PLAYER_NOT_FOUND:%', p_code;
  end if;
  return _player_json(v);
end;
$$;

create or replace function poll_player_by_link(p_join_token text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state game_state;
begin
  select * into v_state from game_state where id = 1;
  if p_join_token is distinct from v_state.join_token then
    if exists (select 1 from game_archives where join_token = p_join_token) then
      raise exception 'GAME_ARCHIVED';
    end if;
    raise exception 'BAD_GAME_LINK';
  end if;
  return poll_player(p_code);
end;
$$;

create or replace function admin_dashboard(p_admin_key text)
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
      'stamps', (select count(*) from attempts a join players p on p.id = a.player_id
                 where not p.is_removed and a.status in ('passed', 'failed')),
      'life_events', (select count(*) from life_events e join players p on p.id = e.player_id
                      where not p.is_removed),
      'top_score', coalesce((select max(score) from players where not is_removed), 0)
    ),
    'archives', coalesce((
      select jsonb_agg(jsonb_build_object(
        'event_id', source_event_id,
        'title', title,
        'phase', phase,
        'created_at', created_at,
        'started_at', started_at,
        'ended_at', ended_at,
        'player_count', player_count,
        'top_score', top_score,
        'stamps', stamps
      ) order by archived_at desc)
      from (select * from game_archives order by archived_at desc limit 12) recent
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function admin_update_game(
  p_admin_key text,
  p_title text default null,
  p_join_open boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state game_state;
  v_title text := trim(coalesce(p_title, ''));
begin
  perform _require_key('admin', p_admin_key);
  if p_title is not null and (length(v_title) < 1 or length(v_title) > 60) then
    raise exception 'BAD_GAME_TITLE';
  end if;
  update game_state set
    title = case when p_title is null then title else v_title end,
    join_open = coalesce(p_join_open, join_open)
  where id = 1 returning * into v_state;
  return _session_json(v_state);
end;
$$;

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
  if (v_state.phase <> 'ended' and v_players > 0) and not p_force then
    raise exception 'ACTIVE_GAME_EXISTS';
  end if;

  if v_players > 0 or v_state.phase <> 'waiting' then
    insert into game_archives (
      source_event_id, title, join_token, phase, created_at, started_at,
      ended_at, player_count, top_score, stamps, players
    ) values (
      v_state.event_id,
      v_state.title,
      v_state.join_token,
      v_state.phase,
      v_state.created_at,
      v_state.started_at,
      coalesce(v_state.ended_at, case when v_state.phase = 'ended' then now() end),
      v_players,
      coalesce((select max(score) from players where not is_removed), 0),
      (select count(*) from attempts a join players p on p.id = a.player_id
       where not p.is_removed and a.status in ('passed', 'failed')),
      coalesce((select jsonb_agg(
        _player_json(p.*) || jsonb_build_object('is_removed', p.is_removed, 'created_at', p.created_at)
        order by p.score desc, p.created_at
      ) from players p), '[]'::jsonb)
    ) on conflict (source_event_id) do nothing;
  end if;

  -- Operational tables hold only the current session. The archive above is an
  -- immutable snapshot; this keeps every existing scoring RPC fast and avoids
  -- risky cross-session code collisions.
  delete from rpc_results where true;
  delete from admin_actions where true;
  delete from token_usages where true;
  delete from life_events where true;
  delete from attempts where true;
  delete from players where true;

  v_token := encode(extensions.gen_random_bytes(8), 'hex');
  update game_state set
    event_id = gen_random_uuid(),
    title = v_title,
    join_token = v_token,
    join_passphrase = '{sha256}' || encode(extensions.digest(v_token, 'sha256'), 'hex'),
    join_open = true,
    phase = 'waiting',
    created_at = now(),
    started_at = null,
    ended_at = null
  where id = 1 returning * into v_new;

  return _session_json(v_new);
end;
$$;

-- End the current session and close admission. Existing players can continue
-- to open their result page until an administrator creates the next session.
create or replace function end_game(p_admin_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform _require_key('admin', p_admin_key);
  update game_state
  set phase = 'ended', ended_at = now(), join_open = false
  where id = 1;
  return jsonb_build_object('phase', 'ended');
end;
$$;

revoke execute on function _session_json(game_state) from public, anon, authenticated;
grant execute on function
  game_landing(text),
  join_by_link(text, text),
  recover_by_link(text, text),
  poll_player_by_link(text, text),
  admin_dashboard(text),
  admin_update_game(text, text, boolean),
  admin_create_game(text, text, boolean)
to anon, authenticated;
