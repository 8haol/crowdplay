-- Life Passport V3.3
-- 1. 灵魂拷问使用 0..10 自由整数计分。
-- 2. 每个人生事件选择下，不加分 / 减分结果的权重至少过半。
-- 3. Second Chance 可以重挑任意已完成站点，新成绩替换旧成绩。

-- ---------------------------------------------------------------------------
-- Station score modes
-- ---------------------------------------------------------------------------

alter table stations drop constraint if exists stations_scoring_mode_check;
alter table stations add constraint stations_scoring_mode_check
  check (scoring_mode in ('graded', 'free', 'fixed'));

update stations set scoring_mode = 'free' where slug = 'interview';

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
  if v_station.type = 'main' and p_scoring_mode not in ('graded','free','fixed') then
    raise exception 'BAD_SCORING_MODE';
  end if;
  update stations set name_zh = v_name,
    scoring_mode = case when type = 'main' then p_scoring_mode else null end
  where id = p_station_id returning * into v_station;
  return to_jsonb(v_station);
end;
$$;

-- ---------------------------------------------------------------------------
-- Life-event probability rebalance
-- ---------------------------------------------------------------------------

create or replace function _rebalance_life_event_choices(p_choices jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_choice jsonb;
  v_outcome jsonb;
  v_new_choices jsonb := '[]'::jsonb;
  v_new_outcomes jsonb;
  v_positive boolean;
  v_positive_total int;
  v_nonpositive_total int;
  v_weight int;
begin
  for v_choice in select value from jsonb_array_elements(p_choices) loop
    select
      coalesce(sum((o ->> 'weight')::int) filter (where
        coalesce((o ->> 'multiplier')::int, 100) > 100
        or (coalesce((o ->> 'multiplier')::int, 100) = 100 and coalesce((o ->> 'delta')::int, 0) > 0)
      ), 0),
      coalesce(sum((o ->> 'weight')::int) filter (where not (
        coalesce((o ->> 'multiplier')::int, 100) > 100
        or (coalesce((o ->> 'multiplier')::int, 100) = 100 and coalesce((o ->> 'delta')::int, 0) > 0)
      )), 0)
    into v_positive_total, v_nonpositive_total
    from jsonb_array_elements(v_choice -> 'outcomes') o;

    if v_nonpositive_total <= 0 then
      raise exception 'LIFE_EVENT_CHOICE_HAS_NO_NONPOSITIVE_OUTCOME:%', v_choice ->> 'key';
    end if;

    v_new_outcomes := '[]'::jsonb;
    for v_outcome in select value from jsonb_array_elements(v_choice -> 'outcomes') loop
      v_positive := coalesce((v_outcome ->> 'multiplier')::int, 100) > 100
        or (coalesce((v_outcome ->> 'multiplier')::int, 100) = 100
            and coalesce((v_outcome ->> 'delta')::int, 0) > 0);

      if v_positive then
        -- Positive outcomes share at most 40 relative points.
        v_weight := greatest(1, floor((v_outcome ->> 'weight')::numeric * 40 / greatest(v_positive_total, 1))::int);
        v_outcome := jsonb_set(v_outcome, '{tone}', '"good"'::jsonb, true);
      else
        -- Neutral / negative outcomes share at least 60 relative points.
        v_weight := greatest(1, ceil((v_outcome ->> 'weight')::numeric * 60 / v_nonpositive_total)::int);
        v_outcome := jsonb_set(
          v_outcome,
          '{tone}',
          case
            when coalesce((v_outcome ->> 'multiplier')::int, 100) < 100
              or coalesce((v_outcome ->> 'delta')::int, 0) < 0
              then '"bad"'::jsonb
            else '"neutral"'::jsonb
          end,
          true
        );
      end if;
      v_outcome := jsonb_set(v_outcome, '{weight}', to_jsonb(v_weight), true);
      v_new_outcomes := v_new_outcomes || jsonb_build_array(v_outcome);
    end loop;
    v_new_choices := v_new_choices || jsonb_build_array(jsonb_set(v_choice, '{outcomes}', v_new_outcomes, true));
  end loop;
  return v_new_choices;
end;
$$;

update life_event_scenes
set choices = _rebalance_life_event_choices(choices);

-- Pending snapshots should use the safer distribution too; resolved history is
-- immutable and remains an honest record of what actually happened.
update life_event_instances i
set scene_snapshot = jsonb_build_object(
  'title', s.title,
  'prompt', s.prompt,
  'emoji', s.emoji,
  'choices', s.choices
)
from life_event_scenes s
where i.scene_key = s.key and i.state = 'pending';

drop function _rebalance_life_event_choices(jsonb);

-- ---------------------------------------------------------------------------
-- Staff lookup includes each retryable station's previous result.
-- ---------------------------------------------------------------------------

create or replace function staff_lookup_team(p_staff_key text, p_identifier text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_team_id uuid;
  v_team teams;
begin
  perform _require_key('staff', p_staff_key);
  select t.id into v_team_id from teams t
  where upper(t.code) = upper(trim(coalesce(p_identifier, '')))
  limit 1;
  if v_team_id is null then
    select p.team_id into v_team_id from players p
    where p.code = trim(coalesce(p_identifier, '')) and not p.is_removed limit 1;
  end if;
  if v_team_id is null then
    return jsonb_build_object('found', false, 'identifier', trim(coalesce(p_identifier, '')));
  end if;
  select * into v_team from teams where id = v_team_id;
  return jsonb_build_object(
    'found', true,
    'phase', (select phase from game_state where id = 1),
    'team_id', v_team.id,
    'team_code', v_team.code,
    'identity', v_team.identity,
    'color_group', v_team.color_group,
    'challenge_score', v_team.challenge_score,
    'members', coalesce((select jsonb_agg(
      _player_json(p.*) || jsonb_build_object(
        'attempted_station_ids', coalesce((select jsonb_agg(a.station_id) from attempts a
          where a.player_id = p.id and a.status in ('passed','failed')), '[]'::jsonb)
      ) order by p.created_at) from players p
      where p.team_id = v_team.id and not p.is_removed), '[]'::jsonb),
    'attempted_station_ids', coalesce((select jsonb_agg(a.station_id order by s.sort_order)
      from team_attempts a join stations s on s.id = a.station_id
      where a.team_id = v_team.id and a.status in ('passed','failed')), '[]'::jsonb),
    'station_results', coalesce((select jsonb_agg(jsonb_build_object(
      'station_id', a.station_id, 'score', a.score, 'status', a.status
    ) order by s.sort_order) from team_attempts a join stations s on s.id = a.station_id
      where a.team_id = v_team.id and a.status in ('passed','failed')), '[]'::jsonb),
    'retry_station_ids', coalesce((select jsonb_agg(a.station_id) from team_attempts a
      where a.team_id = v_team.id and a.status = 'retry_granted'), '[]'::jsonb),
    'failed_station_ids', coalesce((select jsonb_agg(a.station_id) from team_attempts a
      where a.team_id = v_team.id and a.status = 'failed'
        and not exists (select 1 from team_attempts r where r.team_id = a.team_id
                        and r.station_id = a.station_id and r.status = 'retry_granted')), '[]'::jsonb),
    'all_tokens_available', not exists (select 1 from players p
      where p.team_id = v_team.id and not p.is_removed and not p.token_available)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Help Token: hint cards remain station-agnostic; retries accept any completed
-- station, whether the previous result was failed or merely disappointing.
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
    if not exists (select 1 from stations where id = p_station_id and type = 'main') then
      raise exception 'BAD_STATION';
    end if;
    if not exists (select 1 from team_attempts where team_id = v_team.id
      and station_id = p_station_id and status in ('passed','failed')) then
      raise exception 'TEAM_NOT_ATTEMPTED:%', v_team.code;
    end if;
    if exists (select 1 from team_attempts where team_id = v_team.id
      and station_id = p_station_id and status = 'retry_granted') then
      raise exception 'RETRY_ALREADY_GRANTED:%', v_team.code;
    end if;
    insert into team_attempts (team_id, station_id, status, scored_by)
    values (v_team.id, p_station_id, 'retry_granted', 'token');
  end if;
  for v_player in select * from players where team_id = v_team.id and not is_removed order by id for update loop
    update players set token_available = false where id = v_player.id;
    insert into token_usages (player_id, usage_type, target_station_id)
    values (v_player.id, p_usage_type, case when p_usage_type = 'second_chance' then p_station_id end);
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

-- ---------------------------------------------------------------------------
-- Score recording: a retry replaces its old score instead of accumulating it.
-- ---------------------------------------------------------------------------

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
  v_previous_award int := 0;
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
      select score into v_previous_award from team_attempts
      where team_id = v_team.id and station_id = p_station_id and status in ('passed','failed')
      limit 1;
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
    v_award := 0;
    v_status := 'failed';
  else
    if v_station.scoring_mode = 'graded' and p_score not in (3,6,9) then raise exception 'BAD_TEAM_SCORE'; end if;
    if v_station.scoring_mode = 'free' and (p_score is null or p_score < 0 or p_score > 10) then raise exception 'BAD_TEAM_SCORE'; end if;
    if v_station.scoring_mode = 'fixed' and p_score is distinct from 6 then raise exception 'BAD_TEAM_SCORE'; end if;
    v_award := p_score;
    v_status := 'passed';
  end if;

  insert into team_attempts (team_id, station_id, score, status, scored_by, idempotency_key)
  values (v_team.id, p_station_id, v_award, v_status, 'staff', p_idempotency_key);
  update teams set challenge_score = greatest(0, challenge_score - v_previous_award + v_award)
  where id = v_team.id returning * into v_team;

  for v_player in select * from players where team_id = v_team.id and not is_removed order by id for update loop
    insert into attempts (player_id, station_id, score, status, scored_by, idempotency_key)
    values (v_player.id, p_station_id, v_award, v_status, 'team:' || v_team.code,
            p_idempotency_key || ':' || v_player.code);
    v_new_score := greatest(0, v_player.score - v_previous_award + v_award);
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
    'replaced_award', case when v_retry then v_previous_award end,
    'challenge_score', v_team.challenge_score, 'members', v_members
  );
  insert into rpc_results (idempotency_key, result) values (p_idempotency_key, v_prev);
  return v_prev;
end;
$$;

grant execute on function admin_update_station(text, int, text, text),
  staff_lookup_team(text, text),
  use_team_token(text, text, text, int, text),
  award_team_score(text, text, int, int, boolean, text)
to anon, authenticated;
