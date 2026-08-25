-- Security hardening for the public event deployment.
-- Keeps the existing RPC signatures so already-built clients continue to work.

-- ---------------------------------------------------------------------------
-- 1. Secrets are stored as one-way SHA-256 digests. The matcher deliberately
--    accepts legacy plaintext values so tests and an interrupted rollout remain
--    recoverable; production values are converted below.
-- ---------------------------------------------------------------------------

create or replace function _secret_matches(p_stored text, p_provided text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_stored is null or p_provided is null then false
    when p_stored like '{sha256}%'
      then substring(p_stored from 9) = encode(extensions.digest(p_provided, 'sha256'), 'hex')
    else p_stored = p_provided
  end;
$$;

update app_config
set value = '{sha256}' || encode(extensions.digest(value, 'sha256'), 'hex')
where value not like '{sha256}%';

update game_state
set join_passphrase = '{sha256}' || encode(extensions.digest(join_passphrase, 'sha256'), 'hex')
where join_passphrase not like '{sha256}%';

-- ---------------------------------------------------------------------------
-- 2. Failed-credential throttling. PostgreSQL rolls table writes back when an
--    RPC raises, so a counter written immediately before RAISE is not durable.
--    Instead, serialize invalid attempts per credential surface with a
--    transaction advisory lock. The first bad request is deliberately slowed;
--    concurrent guesses fail immediately. Valid credentials bypass the lock.
-- ---------------------------------------------------------------------------

create or replace function _throttle_failed_attempt(p_scope text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not pg_try_advisory_xact_lock(hashtextextended('life-passport:' || p_scope, 0)) then
    raise exception 'RATE_LIMITED';
  end if;
  perform pg_sleep(0.75);
end;
$$;

create or replace function _require_key(p_kind text, p_key text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_staff text;
  v_admin text;
  v_valid boolean;
begin
  select value into v_admin from app_config where key = 'admin_key';
  select value into v_staff from app_config where key = 'staff_key';

  v_valid := case
    when p_kind = 'admin' then _secret_matches(v_admin, p_key)
    else _secret_matches(v_staff, p_key) or _secret_matches(v_admin, p_key)
  end;

  if v_valid then return; end if;

  perform _throttle_failed_attempt(
    case when p_kind = 'admin' then 'admin-key' else 'staff-key' end
  );
  raise exception 'BAD_KEY';
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Public player RPCs gain failed-attempt throttling. Successful players are
--    never blocked by other people's invalid guesses.
-- ---------------------------------------------------------------------------

create or replace function join_game(p_name text, p_passphrase text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state     game_state;
  v_name      text := trim(coalesce(p_name, ''));
  v_code      text;
  v_id        uuid;
  v_solo_slot int;
  i           int;
begin
  select * into v_state from game_state where id = 1 for update;
  if v_state.phase = 'ended' then
    raise exception 'GAME_ENDED';
  end if;
  if not _secret_matches(v_state.join_passphrase, trim(coalesce(p_passphrase, ''))) then
    perform _throttle_failed_attempt('join-passphrase');
    raise exception 'BAD_PASSPHRASE';
  end if;
  if length(v_name) < 1 or length(v_name) > 20 then
    raise exception 'BAD_NAME';
  end if;

  if v_state.phase = 'playing' then
    select count(*) + 1 into v_solo_slot
    from players where identity = 'solo' and not is_removed;
  end if;

  -- Idempotency results are only useful around an event window.
  delete from rpc_results where created_at < clock_timestamp() - interval '7 days';

  for i in 1..100 loop
    v_code := lpad((floor(random() * 9999) + 1)::int::text, 4, '0');
    begin
      insert into players (name, code, identity, color_group)
      values (
        v_name,
        v_code,
        case when v_state.phase = 'playing' then 'solo' end,
        case when v_state.phase = 'playing'
          then 'solo-' || (((v_solo_slot - 1) % 8) + 1)::text
        end
      )
      returning id into v_id;
      return jsonb_build_object('player_id', v_id, 'code', v_code);
    exception when unique_violation then
      -- Code collision: try another random code.
    end;
  end loop;
  raise exception 'CODE_POOL_EXHAUSTED';
end;
$$;

create or replace function recover_identity(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v players;
begin
  select * into v from players where code = p_code and not is_removed;
  if not found then
    perform _throttle_failed_attempt('player-code');
    raise exception 'PLAYER_NOT_FOUND:%', p_code;
  end if;
  return _player_json(v);
end;
$$;

create or replace function poll_player(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_player players;
  v_state  game_state;
  v_rank   int;
begin
  select * into v_player from players where code = p_code and not is_removed;
  if not found then
    perform _throttle_failed_attempt('player-code');
    raise exception 'PLAYER_NOT_FOUND:%', p_code;
  end if;
  select * into v_state from game_state where id = 1;

  select count(*) + 1 into v_rank
  from players
  where not is_removed and score > v_player.score;

  return jsonb_build_object(
    'phase', v_state.phase,
    'started_at', v_state.started_at,
    'rank', v_rank,
    'player', _player_json(v_player),
    'attempts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'station_id', a.station_id,
               'status', a.status,
               'score', a.score,
               'created_at', a.created_at)
             order by a.created_at)
      from attempts a
      where a.player_id = v_player.id
        and a.status in ('passed', 'failed', 'retry_granted')
    ), '[]'::jsonb),
    'life_events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'card_type', e.card_type,
               'card_label', e.card_label,
               'score_before', e.score_before,
               'score_after', e.score_after,
               'created_at', e.created_at)
             order by e.created_at)
      from life_events e
      where e.player_id = v_player.id
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The legacy leaderboard view is not used by the web app. Keep it for
--    owner-side reports/tests, but remove anonymous access to its 4-digit codes.
-- ---------------------------------------------------------------------------

revoke select on leaderboard from anon, authenticated;

create or replace view public_leaderboard as
  select name, identity, color_group, score
  from players
  where not is_removed
  order by score desc, created_at asc;

grant select on public_leaderboard to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Index every frequently joined foreign-key column used by board/admin RPCs.
-- ---------------------------------------------------------------------------

create index if not exists attempts_station_idx on attempts (station_id);
create index if not exists life_events_player_idx on life_events (player_id);
create index if not exists token_usages_player_idx on token_usages (player_id);
create index if not exists token_usages_station_idx on token_usages (target_station_id);
create index if not exists admin_actions_player_idx on admin_actions (player_id);

-- New functions are executable by PUBLIC by default; helpers must stay private.
revoke execute on function _secret_matches(text, text) from public, anon, authenticated;
revoke execute on function _throttle_failed_attempt(text) from public, anon, authenticated;
revoke execute on function _require_key(text, text) from public, anon, authenticated;

-- Re-assert the intended public RPC surface after CREATE OR REPLACE.
grant execute on function join_game(text, text), recover_identity(text), poll_player(text)
to anon, authenticated;
