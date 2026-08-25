-- Life Passport — all game logic as security-definer RPCs.
-- Error convention: raise exception with a machine-readable message,
-- e.g. 'BAD_PASSPHRASE', 'LOCKED_LIFE_EVENT:1234'. PostgREST surfaces the
-- message in the error body; the frontend switches on the prefix.

-- ===========================================================================
-- Internal helpers (not granted to anon)
-- ===========================================================================

-- Next threshold in the 15/35/45 sequence that is still ahead of both the
-- current progression point and the given score. Never moves backwards;
-- null (past 45) stays null.
create or replace function _advance_threshold(p_score int, p_current int)
returns int
language sql
immutable
as $$
  select case
    when p_current is null then null
    else (
      select min(t)
      from unnest(array[15, 35, 45]) as t
      where t >= p_current and t > p_score
    )
  end;
$$;

-- Validate a shared key. 'staff' accepts the staff key OR the admin key;
-- 'admin' accepts only the admin key.
create or replace function _require_key(p_kind text, p_key text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_staff text;
  v_admin text;
begin
  select value into v_admin from app_config where key = 'admin_key';
  select value into v_staff from app_config where key = 'staff_key';
  if p_key is null or p_key = '' then
    raise exception 'BAD_KEY';
  end if;
  if p_kind = 'admin' then
    if p_key is distinct from v_admin then
      raise exception 'BAD_KEY';
    end if;
  else
    if p_key is distinct from v_staff and p_key is distinct from v_admin then
      raise exception 'BAD_KEY';
    end if;
  end if;
end;
$$;

-- Fetch + row-lock an active player by code.
create or replace function _get_player_locked(p_code text)
returns players
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v players;
begin
  select * into v
  from players
  where code = p_code and not is_removed
  for update;
  if not found then
    raise exception 'PLAYER_NOT_FOUND:%', p_code;
  end if;
  return v;
end;
$$;

-- Player row as the JSON shape every client screen consumes.
create or replace function _player_json(p players)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'player_id', p.id,
    'name', p.name,
    'code', p.code,
    'identity', p.identity,
    'color_group', p.color_group,
    'score', p.score,
    'token_available', p.token_available,
    'locked_for_life_event', p.locked_for_life_event,
    'next_threshold', p.next_threshold,
    'pending_threshold', p.pending_threshold,
    'status_effect', p.status_effect
  );
$$;

-- ===========================================================================
-- 4.1 join_game
-- ===========================================================================
create or replace function join_game(p_name text, p_passphrase text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state game_state;
  v_name  text := trim(coalesce(p_name, ''));
  v_code  text;
  v_id    uuid;
  i       int;
begin
  select * into v_state from game_state where id = 1 for update;
  if v_state.phase = 'ended' then
    raise exception 'GAME_ENDED';
  end if;
  if trim(coalesce(p_passphrase, '')) is distinct from v_state.join_passphrase then
    raise exception 'BAD_PASSPHRASE';
  end if;
  if length(v_name) < 1 or length(v_name) > 20 then
    raise exception 'BAD_NAME';
  end if;

  -- Random unique 4-digit code in 0001..9999 (0000 excluded by construction).
  for i in 1..100 loop
    v_code := lpad((floor(random() * 9999) + 1)::int::text, 4, '0');
    begin
      insert into players (name, code, identity)
      values (v_name, v_code,
              case when v_state.phase = 'playing' then 'solo' end)
      returning id into v_id;
      return jsonb_build_object('player_id', v_id, 'code', v_code);
    exception when unique_violation then
      -- code collision, try another
    end;
  end loop;
  raise exception 'CODE_POOL_EXHAUSTED';
end;
$$;

-- ===========================================================================
-- 4.2 recover_identity
-- ===========================================================================
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
    raise exception 'PLAYER_NOT_FOUND:%', p_code;
  end if;
  return _player_json(v);
end;
$$;

-- ===========================================================================
-- Player polling: one merged query = player + phase + attempts + rank.
-- (Spec's "select own row via RLS" is not possible with a shared anon key,
-- so polling goes through this RPC instead.)
-- ===========================================================================
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

-- ===========================================================================
-- 4.3 start_game
-- ===========================================================================
create or replace function start_game(p_admin_key text, p_quota jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state      game_state;
  v_trio_q     int := coalesce((p_quota ->> 'trio')::int, 0);  -- groups of 3
  v_duo_q      int := coalesce((p_quota ->> 'duo')::int, 0);   -- pairs
  v_ids        uuid[];
  v_total      int;
  v_pos        int := 1;
  v_group      int := 0;
  v_trio_made  int := 0;
  v_duo_made   int := 0;
  -- distinct color slugs; frontend maps slug -> hex + Chinese label
  v_palette    text[] := array[
    'red','orange','yellow','green','teal','cyan','blue','indigo',
    'purple','pink','rose','lime','amber','emerald','sky','violet',
    'fuchsia','coral','gold','navy','olive','maroon','plum','mint'
  ];
  v_color      text;
  g            int;
begin
  perform _require_key('admin', p_admin_key);

  select * into v_state from game_state where id = 1 for update;
  if v_state.phase <> 'waiting' then
    raise exception 'ALREADY_STARTED';
  end if;

  select coalesce(array_agg(id order by random()), '{}') into v_ids
  from players where not is_removed;
  v_total := coalesce(array_length(v_ids, 1), 0);
  if v_total = 0 then
    raise exception 'NO_PLAYERS';
  end if;

  -- Complete trio groups first, then duo pairs; everyone left becomes solo
  -- (including any configured solo quota and all remainders).
  while v_trio_made < v_trio_q and v_pos + 2 <= v_total loop
    v_group := v_group + 1;
    v_color := v_palette[(v_group - 1) % array_length(v_palette, 1) + 1]
               || case when v_group > array_length(v_palette, 1)
                       then '-' || ((v_group - 1) / array_length(v_palette, 1) + 1)::text
                       else '' end;
    for g in 0..2 loop
      update players set identity = 'trio', color_group = v_color
      where id = v_ids[v_pos + g];
    end loop;
    v_pos := v_pos + 3;
    v_trio_made := v_trio_made + 1;
  end loop;

  while v_duo_made < v_duo_q and v_pos + 1 <= v_total loop
    v_group := v_group + 1;
    v_color := v_palette[(v_group - 1) % array_length(v_palette, 1) + 1]
               || case when v_group > array_length(v_palette, 1)
                       then '-' || ((v_group - 1) / array_length(v_palette, 1) + 1)::text
                       else '' end;
    for g in 0..1 loop
      update players set identity = 'duo', color_group = v_color
      where id = v_ids[v_pos + g];
    end loop;
    v_pos := v_pos + 2;
    v_duo_made := v_duo_made + 1;
  end loop;

  update players set identity = 'solo', color_group = null
  where id = any (v_ids[v_pos:v_total]);

  update game_state set phase = 'playing', started_at = now() where id = 1;

  return jsonb_build_object(
    'total_players', v_total,
    'trio_groups', v_trio_made,
    'duo_groups', v_duo_made,
    'solo_players', v_total - v_pos + 1
  );
end;
$$;

-- ===========================================================================
-- 4.4 award_scores (batch of 1-3, all-or-nothing)
-- ===========================================================================
create or replace function award_scores(
  p_staff_key text,
  p_entries jsonb,
  p_station_id int,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev      jsonb;
  v_phase     text;
  v_station   stations;
  v_entry     jsonb;
  v_player    players;
  v_code      text;
  v_failed    boolean;
  v_score     int;
  v_capped    boolean;
  v_triggered boolean;
  v_new_score int;
  v_next      int;
  v_effect    jsonb;
  v_status    text;
  v_results   jsonb := '[]'::jsonb;
  v_n         int;
begin
  perform _require_key('staff', p_staff_key);

  if p_idempotency_key is null or p_idempotency_key = '' then
    raise exception 'MISSING_IDEMPOTENCY_KEY';
  end if;
  select result into v_prev from rpc_results where idempotency_key = p_idempotency_key;
  if found then
    return v_prev;
  end if;

  select phase into v_phase from game_state where id = 1;
  if v_phase <> 'playing' then
    raise exception 'GAME_NOT_PLAYING';
  end if;

  select * into v_station from stations where id = p_station_id;
  if not found or v_station.type <> 'main' then
    raise exception 'BAD_STATION';
  end if;

  v_n := jsonb_array_length(p_entries);
  if v_n is null or v_n < 1 or v_n > 3 then
    raise exception 'BAD_ENTRIES';
  end if;
  if (select count(distinct e ->> 'code') from jsonb_array_elements(p_entries) e) <> v_n then
    raise exception 'DUPLICATE_CODES';
  end if;

  for v_entry in select * from jsonb_array_elements(p_entries) loop
    v_code   := v_entry ->> 'code';
    v_failed := coalesce((v_entry ->> 'failed')::boolean, false);
    v_player := _get_player_locked(v_code);  -- raises PLAYER_NOT_FOUND:code

    if v_player.locked_for_life_event then
      raise exception 'LOCKED_LIFE_EVENT:%', v_code;
    end if;

    -- One real attempt per station, unless a Second Chance is pending.
    if exists (select 1 from attempts
               where player_id = v_player.id and station_id = p_station_id
                 and status in ('passed', 'failed')) then
      if exists (select 1 from attempts
                 where player_id = v_player.id and station_id = p_station_id
                   and status = 'retry_granted') then
        -- Consume the Second Chance: retire the old failed row + the grant.
        update attempts set status = 'superseded'
        where player_id = v_player.id and station_id = p_station_id
          and status in ('passed', 'failed');
        update attempts set status = 'retry_used'
        where player_id = v_player.id and station_id = p_station_id
          and status = 'retry_granted';
      else
        raise exception 'ALREADY_ATTEMPTED:%', v_code;
      end if;
    end if;

    v_capped := false;
    v_effect := v_player.status_effect;

    if v_failed then
      -- Spec order: a failed attempt short-circuits before status_effect,
      -- so cap_next is NOT consumed by a failure.
      v_score  := 0;
      v_status := 'failed';
    else
      v_score := (v_entry ->> 'score')::int;
      if v_station.scoring_mode = 'graded' and v_score not in (3, 6, 9) then
        raise exception 'BAD_SCORE:%', v_code;
      end if;
      if v_station.scoring_mode = 'fixed' and v_score is distinct from 6 then
        raise exception 'BAD_SCORE:%', v_code;
      end if;
      if v_effect ->> 'type' = 'cap_next' then
        v_score  := least(v_score, coalesce((v_effect ->> 'value')::int, 1));
        v_capped := true;
        v_effect := null;
      end if;
      v_status := 'passed';
    end if;

    insert into attempts (player_id, station_id, score, status, scored_by, idempotency_key)
    values (v_player.id, p_station_id, v_score, v_status, 'staff',
            p_idempotency_key || ':' || v_code);

    v_new_score := v_player.score + v_score;
    v_next      := v_player.next_threshold;
    v_triggered := false;
    if v_next is not null and v_new_score >= v_next then
      v_triggered := true;
    end if;

    update players set
      score = v_new_score,
      status_effect = v_effect,
      locked_for_life_event = locked_for_life_event or v_triggered,
      pending_threshold = case when v_triggered then v_next else pending_threshold end,
      next_threshold = case when v_triggered
                            then _advance_threshold(v_new_score, v_next)
                            else v_next end
    where id = v_player.id;

    v_results := v_results || jsonb_build_object(
      'code', v_code,
      'name', v_player.name,
      'status', v_status,
      'awarded', v_score,
      'cap_applied', v_capped,
      'new_score', v_new_score,
      'life_event_triggered', v_triggered,
      'threshold', case when v_triggered then v_next end
    );
  end loop;

  v_prev := jsonb_build_object('results', v_results);
  insert into rpc_results (idempotency_key, result) values (p_idempotency_key, v_prev);
  return v_prev;
end;
$$;

-- ===========================================================================
-- 4.5 apply_life_event
-- ===========================================================================
create or replace function apply_life_event(
  p_staff_key text,
  p_player_code text,
  p_card_type text,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev   jsonb;
  v_phase  text;
  v_player players;
  v_before int;
  v_after  int;
  v_label  text;
  v_effect jsonb;
  v_next   int;
begin
  perform _require_key('staff', p_staff_key);

  if p_idempotency_key is not null then
    select result into v_prev from rpc_results where idempotency_key = p_idempotency_key;
    if found then
      return v_prev;
    end if;
  end if;

  select phase into v_phase from game_state where id = 1;
  if v_phase <> 'playing' then
    raise exception 'GAME_NOT_PLAYING';
  end if;

  v_player := _get_player_locked(p_player_code);
  if not v_player.locked_for_life_event then
    raise exception 'NOT_LOCKED:%', p_player_code;
  end if;

  v_before := v_player.score;
  v_effect := v_player.status_effect;

  case p_card_type
    when 'fortune_double' then
      v_after := v_before * 2;
      v_label := 'Essay 拿了 First Class！总分 ×2';
    when 'fortune_plus3' then
      v_after := v_before + 3;
      v_label := '路上捡到 £10！总分 +3';
    when 'bad_minus5' then
      v_after := greatest(v_before - 5, 0);
      v_label := '被锁在 Flat 门外，总分 -5';
    when 'bad_cap_next' then
      v_after  := v_before;
      v_effect := jsonb_build_object('type', 'cap_next', 'value', 1);
      v_label  := '重感冒卧床，下一站最多得 1 分';
    when 'unexpected_married' then
      v_after := v_before;
      v_label := 'Got Married! 人生大事，分数不变';
    when 'extreme_half' then
      v_after := v_before / 2;  -- integer division = floor for non-negatives
      v_label := '投资暴雷，总分减半';
    else
      raise exception 'BAD_CARD:%', p_card_type;
  end case;

  -- Cards never trigger a new lock. Any threshold the card jumps over is
  -- skipped: next_threshold advances to the first one still above the new
  -- score (and never moves backwards when the score drops).
  v_next := _advance_threshold(v_after, v_player.next_threshold);

  insert into life_events (player_id, threshold, card_type, card_label,
                           score_before, score_after)
  values (v_player.id, v_player.pending_threshold, p_card_type, v_label,
          v_before, v_after);

  update players set
    score = v_after,
    status_effect = v_effect,
    locked_for_life_event = false,
    pending_threshold = null,
    next_threshold = v_next
  where id = v_player.id;

  v_prev := jsonb_build_object(
    'code', p_player_code,
    'name', v_player.name,
    'card_type', p_card_type,
    'card_label', v_label,
    'score_before', v_before,
    'score_after', v_after,
    'next_threshold', v_next
  );
  if p_idempotency_key is not null then
    insert into rpc_results (idempotency_key, result) values (p_idempotency_key, v_prev);
  end if;
  return v_prev;
end;
$$;

-- ===========================================================================
-- 4.6 use_token
-- ===========================================================================
create or replace function use_token(
  p_staff_key text,
  p_player_code text,
  p_usage_type text,
  p_station_id int default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev   jsonb;
  v_phase  text;
  v_player players;
begin
  perform _require_key('staff', p_staff_key);

  if p_idempotency_key is not null then
    select result into v_prev from rpc_results where idempotency_key = p_idempotency_key;
    if found then
      return v_prev;
    end if;
  end if;

  select phase into v_phase from game_state where id = 1;
  if v_phase <> 'playing' then
    raise exception 'GAME_NOT_PLAYING';
  end if;

  if p_usage_type not in ('hint', 'second_chance', 'grace_card') then
    raise exception 'BAD_USAGE_TYPE';
  end if;

  v_player := _get_player_locked(p_player_code);
  if not v_player.token_available then
    raise exception 'NO_TOKEN:%', p_player_code;
  end if;

  if p_usage_type = 'second_chance' then
    if p_station_id is null then
      raise exception 'STATION_REQUIRED';
    end if;
    -- Only a currently-failed station qualifies.
    if not exists (select 1 from attempts
                   where player_id = v_player.id and station_id = p_station_id
                     and status = 'failed') then
      raise exception 'NOT_FAILED_STATION:%', p_player_code;
    end if;
    if exists (select 1 from attempts
               where player_id = v_player.id and station_id = p_station_id
                 and status = 'retry_granted') then
      raise exception 'RETRY_ALREADY_GRANTED:%', p_player_code;
    end if;
    insert into attempts (player_id, station_id, score, status, scored_by)
    values (v_player.id, p_station_id, 0, 'retry_granted', 'staff');
  end if;

  update players set token_available = false where id = v_player.id;
  insert into token_usages (player_id, usage_type, target_station_id)
  values (v_player.id, p_usage_type,
          case when p_usage_type = 'second_chance' then p_station_id end);

  v_prev := jsonb_build_object(
    'code', p_player_code,
    'name', v_player.name,
    'usage_type', p_usage_type,
    'target_station_id', case when p_usage_type = 'second_chance' then p_station_id end
  );
  if p_idempotency_key is not null then
    insert into rpc_results (idempotency_key, result) values (p_idempotency_key, v_prev);
  end if;
  return v_prev;
end;
$$;

-- ===========================================================================
-- Staff helper: look up players by codes before submitting a batch.
-- ===========================================================================
create or replace function staff_lookup(p_staff_key text, p_codes text[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code   text;
  v_player players;
  v_out    jsonb := '[]'::jsonb;
begin
  perform _require_key('staff', p_staff_key);

  foreach v_code in array p_codes loop
    select * into v_player from players where code = v_code and not is_removed;
    if not found then
      v_out := v_out || jsonb_build_object('code', v_code, 'found', false);
    else
      v_out := v_out || (jsonb_build_object('found', true) || _player_json(v_player)
        || jsonb_build_object(
          'attempted_station_ids', coalesce((
            select jsonb_agg(station_id)
            from attempts
            where player_id = v_player.id and status in ('passed', 'failed')
          ), '[]'::jsonb),
          'retry_station_ids', coalesce((
            select jsonb_agg(station_id)
            from attempts
            where player_id = v_player.id and status = 'retry_granted'
          ), '[]'::jsonb),
          -- failed stations with no pending retry = valid Second Chance targets
          'failed_station_ids', coalesce((
            select jsonb_agg(a.station_id)
            from attempts a
            where a.player_id = v_player.id and a.status = 'failed'
              and not exists (select 1 from attempts r
                              where r.player_id = a.player_id
                                and r.station_id = a.station_id
                                and r.status = 'retry_granted')
          ), '[]'::jsonb)));
    end if;
  end loop;
  return v_out;
end;
$$;

-- ===========================================================================
-- 4.7 admin functions
-- ===========================================================================
create or replace function end_game(p_admin_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform _require_key('admin', p_admin_key);
  update game_state set phase = 'ended' where id = 1;
  return jsonb_build_object('phase', 'ended');
end;
$$;

-- Universal escape hatch. Only the explicitly-passed fields change:
--   p_new_score          null = keep
--   p_unlock             true = clear lock + pending_threshold
--   p_clear_effect       true = clear status_effect
--   p_restore_token      true = give the token back
--   p_restore            true = undo a soft delete
--   p_new_next_threshold -1 = keep (default), 0 = set to null, else the value
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
  v_after  players;
begin
  perform _require_key('admin', p_admin_key);

  -- Admin may touch removed players too (needed for p_restore).
  select * into v_player from players where code = p_player_code for update;
  if not found then
    raise exception 'PLAYER_NOT_FOUND:%', p_player_code;
  end if;

  update players set
    score = coalesce(p_new_score, score),
    locked_for_life_event = case when p_unlock then false else locked_for_life_event end,
    pending_threshold = case when p_unlock then null else pending_threshold end,
    status_effect = case when p_clear_effect then null else status_effect end,
    token_available = case when p_restore_token then true else token_available end,
    is_removed = case when p_restore then false else is_removed end,
    next_threshold = case when p_new_next_threshold = -1 then next_threshold
                          when p_new_next_threshold = 0 then null
                          else p_new_next_threshold end
  where id = v_player.id
  returning * into v_after;

  insert into admin_actions (player_id, action, detail, reason)
  values (v_player.id, 'adjust',
          jsonb_build_object('before', _player_json(v_player),
                             'after', _player_json(v_after)),
          p_reason);

  return _player_json(v_after);
end;
$$;

create or replace function admin_remove_player(p_admin_key text, p_player_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_player players;
begin
  perform _require_key('admin', p_admin_key);
  v_player := _get_player_locked(p_player_code);
  update players set is_removed = true where id = v_player.id;
  insert into admin_actions (player_id, action, reason)
  values (v_player.id, 'remove', 'soft delete');
  return jsonb_build_object('code', p_player_code, 'removed', true);
end;
$$;

-- Full roster for the admin table (includes removed players).
create or replace function admin_list_players(p_admin_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform _require_key('admin', p_admin_key);
  return coalesce((
    select jsonb_agg(
             _player_json(p.*) || jsonb_build_object(
               'is_removed', p.is_removed,
               'created_at', p.created_at,
               'attempt_count', (select count(*) from attempts a
                                 where a.player_id = p.id
                                   and a.status in ('passed', 'failed')))
             order by p.created_at)
    from players p
  ), '[]'::jsonb);
end;
$$;

-- ===========================================================================
-- Grants: RPC surface only. Helpers (_*) stay private.
-- ===========================================================================
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  join_game(text, text),
  recover_identity(text),
  poll_player(text),
  start_game(text, jsonb),
  award_scores(text, jsonb, int, text),
  apply_life_event(text, text, text, text),
  use_token(text, text, text, int, text),
  staff_lookup(text, text[]),
  end_game(text),
  admin_adjust(text, text, int, boolean, boolean, boolean, boolean, int, text),
  admin_remove_player(text, text),
  admin_list_players(text)
to anon, authenticated;
