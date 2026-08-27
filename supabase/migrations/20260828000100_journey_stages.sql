-- Life Passport V3 — station-driven life-event stages, retry visibility on the
-- passport, anytime keepsake redemption, and an end-of-event awards payload.
--
-- Why stages replace score thresholds
-- -----------------------------------
-- 15 / 35 / 45 point gates coupled the "life journey" to the score, which had
-- three practical problems on site:
--   * a player who scored 45 from only three stations was told every gate had
--     been experienced, and the passport progress bar filled up early;
--   * `_advance_threshold` skipped the 45 gate whenever a player landed on
--     exactly 45, so most passports only ever saw two of the three events;
--   * a generous or brutal event outcome could jump a player over a gate,
--     silently deleting one of their three life events.
-- Stages are now driven by the number of completed main stations: stage 1 after
-- the 3rd, stage 2 after the 5th, stage 3 after the 7th. Every player gets
-- exactly three, the last one always lands after the whole seven-station run,
-- and the passport progress bar can honestly read 7 stations + 3 events.

-- ---------------------------------------------------------------------------
-- Schema: stage columns
-- ---------------------------------------------------------------------------
alter table life_event_instances
  add column if not exists stage int;

update life_event_instances
set stage = case threshold when 15 then 1 when 35 then 2 else 3 end
where stage is null;

alter table life_event_instances drop constraint if exists life_event_instances_threshold_check;
alter table life_event_instances alter column threshold drop not null;
alter table life_event_instances drop constraint if exists life_event_instances_stage_check;
alter table life_event_instances
  add constraint life_event_instances_stage_check check (stage in (1, 2, 3));
alter table life_event_instances alter column stage set not null;

alter table life_event_instances
  drop constraint if exists life_event_instances_player_id_threshold_key;
create unique index if not exists life_event_instances_one_per_stage
  on life_event_instances (player_id, stage);

alter table life_events add column if not exists stage int;
update life_events
set stage = case threshold when 15 then 1 when 35 then 2 when 45 then 3 end
where stage is null and threshold is not null;

alter table players add column if not exists pending_stage int;
update players set pending_stage = case pending_threshold
  when 15 then 1 when 35 then 2 when 45 then 3 end
where pending_stage is null and pending_threshold is not null;

comment on column life_event_instances.stage is
  'Life journey stage 1/2/3, due after 3 / 5 / 7 completed main stations.';
comment on column life_event_instances.threshold is
  'Legacy score gate (15/35/45). Kept for historic rows; new rows leave it null.';

-- ---------------------------------------------------------------------------
-- Stage helpers
-- ---------------------------------------------------------------------------

/* Completed main stations for one passport. Retry grants are not completions. */
create or replace function _main_stations_done(p_player_id uuid)
returns int
language sql
stable
set search_path = public, pg_temp
as $$
  select count(*)::int
  from attempts a join stations s on s.id = a.station_id
  where a.player_id = p_player_id
    and a.status in ('passed', 'failed')
    and s.type = 'main';
$$;

/* Total main stations in play (7 in the shipped seed, but admins can edit). */
create or replace function _main_station_total()
returns int
language sql
stable
set search_path = public, pg_temp
as $$
  select greatest(count(*)::int, 1) from stations where type = 'main';
$$;

/* Stations completed before stage N unlocks. Scales with the station count so
   an edited seed (say 6 or 9 stations) still spreads three events sensibly and
   always lands the last one on the final station. */
create or replace function _stage_unlock_at(p_stage int)
returns int
language sql
stable
set search_path = public, pg_temp
as $$
  select case p_stage
    when 1 then greatest(1, round(_main_station_total() * 3.0 / 7.0)::int)
    when 2 then greatest(2, round(_main_station_total() * 5.0 / 7.0)::int)
    when 3 then _main_station_total()
  end;
$$;

/* Highest stage a passport has earned the right to experience. */
create or replace function _due_stage(p_player_id uuid)
returns int
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(max(s), 0)
  from generate_series(1, 3) s
  where _main_stations_done(p_player_id) >= _stage_unlock_at(s);
$$;

/* The next stage this passport has not met yet (pending or resolved), or null
   once all three are on the record. */
create or replace function _next_stage(p_player_id uuid)
returns int
language sql
stable
set search_path = public, pg_temp
as $$
  select min(s) from generate_series(1, 3) s
  where not exists (
    select 1 from life_event_instances i
    where i.player_id = p_player_id and i.stage = s and i.state <> 'cancelled'
  );
$$;

/*
 * Create the next due life event for a passport, if one is owed and nothing is
 * already pending. Called after a station is scored and again after an event is
 * resolved, so a player who was mid-event when their team finished another
 * station still receives the stage they earned.
 */
create or replace function _sync_life_event(p_player_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_player players;
  v_due int;
  v_stage int;
  v_id uuid;
begin
  select * into v_player from players where id = p_player_id for update;
  if not found or v_player.is_removed then return null; end if;
  if exists (select 1 from life_event_instances
             where player_id = p_player_id and state = 'pending') then
    return null; -- one pending event per player, by design
  end if;

  v_due := _due_stage(p_player_id);
  if v_due = 0 then return null; end if;

  select min(s) into v_stage from generate_series(1, v_due) s
  where not exists (select 1 from life_event_instances i
                    where i.player_id = p_player_id and i.stage = s and i.state <> 'cancelled');
  if v_stage is null then return null; end if;

  v_id := _create_event_for_player(v_player, v_stage, v_player.score);
  update players set locked_for_life_event = true, pending_stage = v_stage,
                     pending_threshold = null
  where id = p_player_id;
  return v_id;
end;
$$;

/* Scene picker now stamps a stage instead of a score gate. */
drop function if exists _create_event_for_player(players, int, int);
create or replace function _create_event_for_player(
  p_player players,
  p_stage int,
  p_score int
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_scene life_event_scenes;
  v_audience text;
  v_id uuid;
begin
  v_audience := case when random() < 0.62 then coalesce(p_player.identity, 'solo') else 'all' end;

  select * into v_scene from life_event_scenes s
  where s.active and s.audience = v_audience
    and not exists (select 1 from life_event_instances i
                    where i.player_id = p_player.id and i.scene_key = s.key)
  order by random() limit 1;

  if not found then
    select * into v_scene from life_event_scenes s
    where s.active and s.audience in ('all', coalesce(p_player.identity, 'solo'))
      and not exists (select 1 from life_event_instances i
                      where i.player_id = p_player.id and i.scene_key = s.key)
    order by random() limit 1;
  end if;
  if not found then raise exception 'NO_EVENT_SCENE'; end if;

  insert into life_event_instances (
    player_id, stage, scene_key, scene_snapshot, score_at_trigger
  ) values (
    p_player.id, p_stage,
    v_scene.key,
    jsonb_build_object('title', v_scene.title, 'prompt', v_scene.prompt,
                       'emoji', v_scene.emoji, 'choices', v_scene.choices),
    p_score
  ) returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Player payloads
-- ---------------------------------------------------------------------------

/*
 * Passport progress is now measured in real milestones — completed stations and
 * resolved life events — not in points. `next_threshold` is deliberately gone:
 * a score-shaped field kept inviting score-shaped progress bars.
 */
create or replace function _player_json(p players)
returns jsonb
language sql
stable
set search_path = public, pg_temp
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
    'status_effect', p.status_effect,
    'team_id', p.team_id,
    'team_code', (select t.code from teams t where t.id = p.team_id),
    'team_challenge_score', (select t.challenge_score from teams t where t.id = p.team_id),
    'stations_done', _main_stations_done(p.id),
    'stations_total', _main_station_total(),
    'life_events_done', (select count(*)::int from life_event_instances i
                         where i.player_id = p.id and i.state = 'resolved'),
    'life_events_total', 3,
    'pending_stage', p.pending_stage,
    'next_event_stage', _next_stage(p.id),
    'next_event_after_station', (select _stage_unlock_at(_next_stage(p.id)))
  );
$$;

create or replace function _pending_event_json(p_player_id uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', i.id,
    'stage', i.stage,
    'title', i.scene_snapshot ->> 'title',
    'prompt', i.scene_snapshot ->> 'prompt',
    'emoji', i.scene_snapshot ->> 'emoji',
    -- Deliberately strip every hidden outcome. The browser never receives an
    -- answer table, so players cannot inspect source or network data to leak it.
    'choices', coalesce((select jsonb_agg(jsonb_build_object(
      'key', c ->> 'key', 'label', c ->> 'label'
    ) order by ord) from jsonb_array_elements(i.scene_snapshot -> 'choices')
      with ordinality as choice_rows(c, ord)), '[]'::jsonb),
    'created_at', i.created_at
  )
  from life_event_instances i
  where i.player_id = p_player_id and i.state = 'pending'
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Station scoring: stage sync + retry stamps on every member's passport
-- ---------------------------------------------------------------------------

/*
 * Two changes from the previous version:
 *   1. Life events are created by _sync_life_event (stages, not score gates).
 *   2. A team Second Chance now leaves a visible mark on each member's
 *      passport. Previously the retry lived only in `team_attempts`, so a
 *      player who had just been granted a retry still saw a red "未通过" stamp.
 */
create or replace function award_team_score(
  p_staff_key text,
  p_identifier text,
  p_station_id int,
  p_score int,
  p_failed boolean,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev jsonb;
  v_lookup jsonb;
  v_team teams;
  v_station stations;
  v_player players;
  v_award int;
  v_status text;
  v_new_score int;
  v_event_id uuid;
  v_stage int;
  v_retry boolean := false;
  v_members jsonb := '[]'::jsonb;
begin
  perform _require_key('staff', p_staff_key);
  if p_idempotency_key is null or p_idempotency_key = '' then raise exception 'MISSING_IDEMPOTENCY_KEY'; end if;
  select result into v_prev from rpc_results where idempotency_key = p_idempotency_key;
  if found then return v_prev; end if;
  if (select phase from game_state where id = 1) <> 'playing' then raise exception 'GAME_NOT_PLAYING'; end if;

  v_lookup := staff_lookup_team(p_staff_key, p_identifier);
  if not coalesce((v_lookup ->> 'found')::boolean, false) then raise exception 'TEAM_NOT_FOUND:%', p_identifier; end if;
  select * into v_team from teams where id = (v_lookup ->> 'team_id')::uuid for update;
  select * into v_station from stations where id = p_station_id;
  if not found or v_station.type <> 'main' then raise exception 'BAD_STATION'; end if;

  if exists (select 1 from team_attempts where team_id = v_team.id and station_id = p_station_id
             and status in ('passed','failed')) then
    if exists (select 1 from team_attempts where team_id = v_team.id and station_id = p_station_id
               and status = 'retry_granted') then
      v_retry := true;
      update team_attempts set status = 'superseded' where team_id = v_team.id
        and station_id = p_station_id and status in ('passed','failed');
      update team_attempts set status = 'retry_used' where team_id = v_team.id
        and station_id = p_station_id and status = 'retry_granted';
      update attempts set status = 'superseded' where player_id in
        (select id from players where team_id = v_team.id)
        and station_id = p_station_id and status in ('passed','failed');
      update attempts set status = 'retry_used' where player_id in
        (select id from players where team_id = v_team.id)
        and station_id = p_station_id and status = 'retry_granted';
    else
      raise exception 'TEAM_ALREADY_ATTEMPTED:%', v_team.code;
    end if;
  end if;

  if coalesce(p_failed, false) then
    v_award := 0; v_status := 'failed';
  else
    if v_station.scoring_mode = 'graded' and p_score not in (3,6,9) then raise exception 'BAD_TEAM_SCORE'; end if;
    if v_station.scoring_mode = 'fixed' and p_score is distinct from 6 then raise exception 'BAD_TEAM_SCORE'; end if;
    v_award := p_score; v_status := 'passed';
  end if;

  insert into team_attempts (team_id, station_id, score, status, scored_by, idempotency_key)
  values (v_team.id, p_station_id, v_award, v_status, 'staff', p_idempotency_key);
  update teams set challenge_score = challenge_score + v_award where id = v_team.id
  returning * into v_team;

  for v_player in select * from players where team_id = v_team.id and not is_removed order by id for update loop
    insert into attempts (player_id, station_id, score, status, scored_by, idempotency_key)
    values (v_player.id, p_station_id, v_award, v_status, 'team:' || v_team.code,
            p_idempotency_key || ':' || v_player.code);
    v_new_score := v_player.score + v_award;
    update players set score = v_new_score where id = v_player.id;

    v_event_id := _sync_life_event(v_player.id);
    select pending_stage into v_stage from players where id = v_player.id;

    v_members := v_members || jsonb_build_object(
      'code', v_player.code, 'name', v_player.name, 'awarded', v_award,
      'new_score', v_new_score,
      'life_event_triggered', v_event_id is not null,
      'stage', case when v_event_id is not null then v_stage end,
      'event_id', v_event_id
    );
  end loop;

  v_prev := jsonb_build_object(
    'team_code', v_team.code, 'identity', v_team.identity,
    'status', v_status, 'awarded', v_award, 'retry_used', v_retry,
    'challenge_score', v_team.challenge_score, 'members', v_members
  );
  insert into rpc_results (idempotency_key, result) values (p_idempotency_key, v_prev);
  return v_prev;
end;
$$;

-- ---------------------------------------------------------------------------
-- Resolving an event: stage bookkeeping, then pull forward anything owed
-- ---------------------------------------------------------------------------
create or replace function choose_life_event_by_link(
  p_join_token text,
  p_player_code text,
  p_event_id uuid,
  p_choice_key text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state game_state;
  v_player players;
  v_instance life_event_instances;
  v_choice jsonb;
  v_outcome jsonb;
  v_candidate jsonb;
  v_total int := 0;
  v_roll int;
  v_cursor int := 0;
  v_before int;
  v_after int;
  v_delta int;
  v_multiplier int;
  v_result jsonb;
  v_next_event uuid;
begin
  select * into v_state from game_state where id = 1;
  if p_join_token is distinct from v_state.join_token then raise exception 'BAD_GAME_LINK'; end if;
  if v_state.phase <> 'playing' then raise exception 'GAME_NOT_PLAYING'; end if;
  select * into v_player from players where code = p_player_code and not is_removed for update;
  if not found then raise exception 'PLAYER_NOT_FOUND:%', p_player_code; end if;
  select * into v_instance from life_event_instances
    where id = p_event_id and player_id = v_player.id for update;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  if v_instance.state = 'resolved' then return v_instance.result_snapshot; end if;
  if v_instance.state <> 'pending' then raise exception 'EVENT_NOT_PENDING'; end if;

  select c into v_choice from jsonb_array_elements(v_instance.scene_snapshot -> 'choices') c
  where c ->> 'key' = p_choice_key limit 1;
  if v_choice is null then raise exception 'BAD_EVENT_CHOICE'; end if;
  select coalesce(sum((o ->> 'weight')::int), 0) into v_total
    from jsonb_array_elements(v_choice -> 'outcomes') o;
  if v_total <= 0 then raise exception 'BAD_EVENT_OUTCOMES'; end if;
  v_roll := floor(random() * v_total)::int + 1;
  for v_candidate in select * from jsonb_array_elements(v_choice -> 'outcomes') loop
    v_cursor := v_cursor + (v_candidate ->> 'weight')::int;
    if v_roll <= v_cursor then v_outcome := v_candidate; exit; end if;
  end loop;

  v_before := v_player.score;
  v_delta := coalesce((v_outcome ->> 'delta')::int, 0);
  v_multiplier := coalesce((v_outcome ->> 'multiplier')::int, 100);
  v_after := greatest(0, floor(v_before * v_multiplier / 100.0)::int + v_delta);

  insert into life_events (
    player_id, threshold, stage, card_type, card_label, score_before, score_after,
    scene_key, scene_title, choice_key, choice_label, outcome_key, outcome_detail
  ) values (
    v_player.id, null, v_instance.stage,
    'choice_' || v_instance.scene_key,
    v_outcome ->> 'label', v_before, v_after,
    v_instance.scene_key, v_instance.scene_snapshot ->> 'title',
    p_choice_key, v_choice ->> 'label', v_outcome ->> 'key', v_outcome ->> 'detail'
  );

  update players set score = v_after, locked_for_life_event = false,
    pending_stage = null, pending_threshold = null where id = v_player.id;

  v_result := jsonb_build_object(
    'event_id', v_instance.id,
    'stage', v_instance.stage,
    'scene_title', v_instance.scene_snapshot ->> 'title',
    'choice_label', v_choice ->> 'label',
    'outcome_key', v_outcome ->> 'key',
    'outcome_label', v_outcome ->> 'label',
    'outcome_detail', v_outcome ->> 'detail',
    'tone', coalesce(v_outcome ->> 'tone', 'neutral'),
    'score_before', v_before, 'score_after', v_after,
    'delta', v_after - v_before
  );
  update life_event_instances set state = 'resolved', choice_key = p_choice_key,
    result_snapshot = v_result, resolved_at = clock_timestamp() where id = v_instance.id;

  -- A team may have cleared another station while this event was open; hand the
  -- player the stage they already earned instead of losing it.
  v_next_event := _sync_life_event(v_player.id);
  v_result := v_result || jsonb_build_object(
    'next_event_stage', _next_stage(v_player.id),
    'next_pending_event_id', v_next_event
  );
  update life_event_instances set result_snapshot = v_result where id = v_instance.id;

  if p_idempotency_key is not null and p_idempotency_key <> '' then
    insert into rpc_results (idempotency_key, result) values (p_idempotency_key, v_result)
    on conflict (idempotency_key) do nothing;
  end if;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tokens: retry stamped on passports, keepsake redeemable at any time
-- ---------------------------------------------------------------------------
create or replace function use_team_token(
  p_staff_key text,
  p_identifier text,
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
  v_prev jsonb;
  v_lookup jsonb;
  v_team teams;
  v_player players;
  v_members jsonb := '[]'::jsonb;
begin
  perform _require_key('staff', p_staff_key);
  if p_idempotency_key is not null then
    select result into v_prev from rpc_results where idempotency_key = p_idempotency_key;
    if found then return v_prev; end if;
  end if;
  if (select phase from game_state where id = 1) <> 'playing' then raise exception 'GAME_NOT_PLAYING'; end if;
  if p_usage_type not in ('hint','second_chance') then raise exception 'BAD_USAGE_TYPE'; end if;
  v_lookup := staff_lookup_team(p_staff_key, p_identifier);
  if not coalesce((v_lookup ->> 'found')::boolean, false) then raise exception 'TEAM_NOT_FOUND:%', p_identifier; end if;
  select * into v_team from teams where id = (v_lookup ->> 'team_id')::uuid for update;
  if exists (select 1 from players where team_id = v_team.id and not is_removed and not token_available) then
    raise exception 'TEAM_TOKEN_INCOMPLETE:%', v_team.code;
  end if;
  if p_usage_type = 'second_chance' then
    if p_station_id is null then raise exception 'STATION_REQUIRED'; end if;
    if not exists (select 1 from team_attempts where team_id = v_team.id
      and station_id = p_station_id and status = 'failed') then raise exception 'TEAM_NOT_FAILED:%', v_team.code; end if;
    if exists (select 1 from team_attempts where team_id = v_team.id
      and station_id = p_station_id and status = 'retry_granted') then raise exception 'RETRY_ALREADY_GRANTED:%', v_team.code; end if;
    insert into team_attempts (team_id, station_id, status, scored_by)
    values (v_team.id, p_station_id, 'retry_granted', 'token');
  end if;
  for v_player in select * from players where team_id = v_team.id and not is_removed order by id for update loop
    update players set token_available = false where id = v_player.id;
    insert into token_usages (player_id, usage_type, target_station_id)
    values (v_player.id, p_usage_type, case when p_usage_type = 'second_chance' then p_station_id end);
    -- Mirror the grant onto the personal passport so the station card flips
    -- from "未通过" to "可重新挑战" on the player's own phone.
    if p_usage_type = 'second_chance' then
      insert into attempts (player_id, station_id, score, status, scored_by)
      values (v_player.id, p_station_id, 0, 'retry_granted', 'token')
      on conflict do nothing;
    end if;
    v_members := v_members || jsonb_build_object('code', v_player.code, 'name', v_player.name);
  end loop;
  v_prev := jsonb_build_object('team_code', v_team.code, 'usage_type', p_usage_type,
    'target_station_id', p_station_id, 'members', v_members);
  if p_idempotency_key is not null then
    insert into rpc_results (idempotency_key, result) values (p_idempotency_key, v_prev);
  end if;
  return v_prev;
end;
$$;

/* Keepsake cards are a pastoral moment, not a prize ceremony: a player who has
   decided not to spend their token on the team can walk to the Grace station at
   any point during the event. */
create or replace function redeem_token_card(
  p_staff_key text,
  p_player_code text,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_phase text;
  v_player players;
  v_result jsonb;
begin
  perform _require_key('staff', p_staff_key);
  if p_idempotency_key is not null and p_idempotency_key <> '' then
    select result into v_result from rpc_results where idempotency_key = p_idempotency_key;
    if found then return v_result; end if;
  end if;
  select phase into v_phase from game_state where id = 1;
  if v_phase = 'waiting' then raise exception 'CARD_REDEMPTION_NOT_OPEN'; end if;
  select * into v_player from players where code = p_player_code and not is_removed for update;
  if not found then raise exception 'PLAYER_NOT_FOUND:%', p_player_code; end if;
  if not v_player.token_available then raise exception 'NO_TOKEN:%', p_player_code; end if;
  update players set token_available = false where id = v_player.id;
  insert into token_usages (player_id, usage_type) values (v_player.id, 'grace_card');
  v_result := jsonb_build_object('code', v_player.code, 'name', v_player.name,
                                 'usage_type', 'grace_card');
  if p_idempotency_key is not null and p_idempotency_key <> '' then
    insert into rpc_results (idempotency_key, result) values (p_idempotency_key, v_result)
    on conflict (idempotency_key) do nothing;
  end if;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Player polling: expose the resolved stage on the life-event log
-- ---------------------------------------------------------------------------
create or replace function poll_player(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_player players;
  v_state game_state;
  v_rank int;
  v_team_rank int;
begin
  select * into v_player from players where code = p_code and not is_removed;
  if not found then
    perform _throttle_failed_attempt('player-code');
    raise exception 'PLAYER_NOT_FOUND:%', p_code;
  end if;
  select * into v_state from game_state where id = 1;
  select count(*) + 1 into v_rank from players
    where not is_removed and score > v_player.score;
  select count(*) + 1 into v_team_rank from teams
    where challenge_score > coalesce((select challenge_score from teams where id = v_player.team_id), 0);

  return jsonb_build_object(
    'phase', v_state.phase,
    'started_at', v_state.started_at,
    'rank', v_rank,
    'team_rank', v_team_rank,
    'player', _player_json(v_player),
    'team', _team_json(v_player.team_id),
    'pending_event', _pending_event_json(v_player.id),
    'attempts', coalesce((select jsonb_agg(jsonb_build_object(
      'station_id', a.station_id, 'status', a.status, 'score', a.score,
      'created_at', a.created_at) order by a.created_at)
      from attempts a where a.player_id = v_player.id
        and a.status in ('passed','failed','retry_granted')), '[]'::jsonb),
    'life_events', coalesce((select jsonb_agg(jsonb_build_object(
      'card_type', e.card_type, 'card_label', e.card_label,
      'stage', e.stage,
      'scene_title', e.scene_title, 'choice_label', e.choice_label,
      'outcome_detail', e.outcome_detail,
      'score_before', e.score_before, 'score_after', e.score_after,
      'created_at', e.created_at) order by e.created_at)
      from life_events e where e.player_id = v_player.id), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- End-of-event awards (projector ceremony)
-- ---------------------------------------------------------------------------

/* One row per active passport with every metric the ceremony can award on. */
create or replace function _award_stats()
returns table (
  player_id uuid,
  name text,
  team_code text,
  color_group text,
  identity text,
  score int,
  joined_at timestamptz,
  ev_net int,
  ev_swing int,
  ev_count int,
  st_total int,
  st_nines int,
  st_done int,
  st_last timestamptz
)
language sql
stable
set search_path = public, pg_temp
as $$
  select p.id, p.name, t.code, p.color_group, p.identity, p.score, p.created_at,
         coalesce(e.net, 0)::int, coalesce(e.swing, 0)::int, coalesce(e.n, 0)::int,
         coalesce(s.total, 0)::int, coalesce(s.nines, 0)::int, coalesce(s.done, 0)::int,
         s.last_at
  from players p
  left join teams t on t.id = p.team_id
  left join (
    select le.player_id,
           sum(le.score_after - le.score_before) net,
           max(abs(le.score_after - le.score_before)) swing,
           count(*) n
    from life_events le group by le.player_id
  ) e on e.player_id = p.id
  left join (
    select a.player_id,
           sum(a.score) total,
           count(*) filter (where a.score >= 9) nines,
           count(*) done,
           max(a.created_at) last_at
    from attempts a join stations st2 on st2.id = a.station_id
    where st2.type = 'main' and a.status in ('passed', 'failed')
    group by a.player_id
  ) s on s.player_id = p.id
  where not p.is_removed;
$$;

/* Pick the single winner of one award. Prefers somebody who has not won yet so
   the ceremony spreads across the room, but never leaves an award empty when a
   qualifying player exists. `joined_at` is the final tie-break, so every award
   resolves to exactly one person. */
create or replace function _pick_award(
  p_qualify text,
  p_metric text,
  p_desc boolean,
  p_exclude uuid[]
)
returns uuid
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_dir text := case when p_desc then 'desc' else 'asc' end;
begin
  execute format(
    'select player_id from _award_stats() where %s and not (player_id = any($1))
     order by %s %s, joined_at asc, player_id::text limit 1', p_qualify, p_metric, v_dir)
  into v_id using coalesce(p_exclude, '{}'::uuid[]);
  if v_id is null then
    execute format(
      'select player_id from _award_stats() where %s order by %s %s, joined_at asc, player_id::text limit 1',
      p_qualify, p_metric, v_dir) into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function _event_awards()
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_podium jsonb := '[]'::jsonb;
  v_awards jsonb := '[]'::jsonb;
  v_used uuid[] := '{}';
  v_row record;
  v_id uuid;
  v_stat record;
  v_rank int := 0;
  v_total int := _main_station_total();
begin
  for v_row in
    select * from _award_stats() order by score desc, joined_at asc, player_id::text limit 3
  loop
    v_rank := v_rank + 1;
    v_podium := v_podium || jsonb_build_object(
      'rank', v_rank, 'name', v_row.name, 'score', v_row.score,
      'team_code', v_row.team_code, 'color_group', v_row.color_group,
      'identity', v_row.identity, 'stations_done', v_row.st_done,
      'life_events', v_row.ev_count
    );
    v_used := v_used || v_row.player_id;
  end loop;

  -- Each entry: qualify clause, metric, descending?, key, emoji, title,
  -- subtitle, and a caption template with %s for the metric value.
  for v_row in
    select * from (values
      ('ev_net > 0',   'ev_net',   true,  'lucky',
        '🍀', '天选之子', '人生事件加分最多',      '人生事件净赚 +%s 分'),
      ('ev_net < 0',   'ev_net',   false, 'unlucky',
        '🌧️', '时运不济', '人生事件扣分最多',      '人生事件净亏 %s 分'),
      ('st_nines > 0', 'st_nines', true,  'perfect',
        '⭐', '满分收藏家', '拿下满分的挑战最多',   '%s 站拿到满分 9 分'),
      ('st_total > 0', 'st_total', true,  'steady',
        '🎯', '稳定输出',  '挑战本身拿分最高',      '七站挑战共 %s 分'),
      ('ev_swing > 0', 'ev_swing', true,  'rollercoaster',
        '🎢', '人生过山车', '单次人生事件波动最大',  '一次事件波动 %s 分'),
      ('st_last is not null and st_done >= ' || v_total, 'st_last', false, 'finisher',
        '⚡', '一路向前',  '最先走完全部站点',      '全场第一个完成 %s 站')
    ) as t(qualify, metric, is_desc, key, emoji, title, subtitle, caption)
  loop
    v_id := _pick_award(v_row.qualify, v_row.metric, v_row.is_desc, v_used);
    if v_id is null then continue; end if;
    select * into v_stat from _award_stats() where player_id = v_id;
    v_used := v_used || v_id;
    v_awards := v_awards || jsonb_build_object(
      'key', v_row.key, 'emoji', v_row.emoji, 'title', v_row.title,
      'subtitle', v_row.subtitle,
      'name', v_stat.name, 'team_code', v_stat.team_code,
      'color_group', v_stat.color_group, 'identity', v_stat.identity,
      'score', v_stat.score,
      'caption', format(v_row.caption, case v_row.key
        when 'lucky' then v_stat.ev_net::text
        when 'unlucky' then abs(v_stat.ev_net)::text
        when 'perfect' then v_stat.st_nines::text
        when 'steady' then v_stat.st_total::text
        when 'rollercoaster' then v_stat.ev_swing::text
        else v_stat.st_done::text end)
    );
  end loop;

  return jsonb_build_object(
    'podium', v_podium,
    'specials', v_awards,
    'team', (
      select jsonb_build_object(
        'code', t.code, 'identity', t.identity, 'color_group', t.color_group,
        'total', sum(p.score)::int,
        'members', string_agg(p.name, ' / ' order by p.created_at)
      )
      from teams t join players p on p.team_id = t.id and not p.is_removed
      group by t.id, t.code, t.identity, t.color_group
      having count(p.id) > 1
      order by sum(p.score) desc, min(p.created_at) asc
      limit 1
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Projector snapshot
-- ---------------------------------------------------------------------------
/*
 * Ordering deliberately groups teammates instead of ranking by score. A live
 * scoreboard on the wall told everyone who was winning for the whole hour,
 * which is the opposite of the point; the reveal now belongs to the ceremony.
 * The frontend re-sorts by score only once `phase = 'ended'`.
 *
 * Feed items carry structured fields (scene / choice / outcome / stage) so the
 * ticker can write a readable sentence instead of gluing a scene title onto an
 * outcome label.
 */
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
    'stations_total', _main_station_total(),
    'players', coalesce((select jsonb_agg(row_json order by sort_team, sort_created, sort_id) from (
      select coalesce(t.code, 'ZZZ') sort_team, p.created_at sort_created, p.id::text sort_id, jsonb_build_object(
        'id', p.id, 'name', p.name, 'team_code', t.code,
        'member_count', (select count(*) from players m where m.team_id = p.team_id and not m.is_removed),
        'identity', p.identity, 'color_group', p.color_group, 'score', p.score,
        'locked', p.locked_for_life_event, 'token_available', p.token_available,
        'sick', (p.status_effect ->> 'type') = 'cap_next',
        'stations_done', _main_stations_done(p.id),
        'life_events_done', (select count(*) from life_event_instances i
                             where i.player_id = p.id and i.state = 'resolved')
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
    'awards', case when v_state.phase = 'ended' then _event_awards() end,
    'feed', coalesce((select jsonb_agg(item order by created_at desc) from (
      select created_at, item from (
        select e.created_at, jsonb_build_object(
          'id', 'e' || e.id, 'kind', 'life_event', 'name', p.name,
          'card', e.card_type,
          'label', e.card_label,
          'scene', e.scene_title, 'choice', e.choice_label, 'outcome', e.card_label,
          'stage', e.stage,
          'threshold', e.threshold, 'before', e.score_before, 'after', e.score_after, 'at', e.created_at
        ) item from life_events e join players p on p.id = e.player_id where not p.is_removed
        union all
        select a.created_at, jsonb_build_object(
          'id', 'ta' || a.id, 'kind', 'attempt',
          'name', coalesce((select string_agg(p.name, ' / ' order by p.created_at)
                            from players p where p.team_id = t.id and not p.is_removed), t.code),
          'team_code', t.code,
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
          'team_code', (select t.code from teams t where t.id = p.team_id),
          'usage', u.usage_type, 'station', s.name_zh, 'at', u.created_at
        ) from token_usages u join players p on p.id = u.player_id
          left join stations s on s.id = u.target_station_id where not p.is_removed
      ) feed_union order by created_at desc limit 60
    ) recent), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function
  _main_stations_done(uuid), _main_station_total(), _stage_unlock_at(int),
  _due_stage(uuid), _next_stage(uuid), _sync_life_event(uuid),
  _create_event_for_player(players, int, int),
  _award_stats(), _pick_award(text, text, boolean, uuid[]), _event_awards()
  from public, anon, authenticated;

grant execute on function
  board_snapshot(),
  poll_player(text),
  award_team_score(text, text, int, int, boolean, text),
  choose_life_event_by_link(text, text, uuid, text, text),
  use_team_token(text, text, text, int, text),
  redeem_token_card(text, text, text)
to anon, authenticated;
