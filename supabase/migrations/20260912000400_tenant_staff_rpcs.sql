-- Life Passport · 多租户阶段 1 · 工作人员 RPC
-- p_staff_key 就是本场的 6 位 staff_code。它同时是凭证和场次选择器：
-- 工作人员输一次码，之后每个调用都落在同一场，不可能录到别的教会的队伍上。
-- 幂等键统一加场次前缀，两场使用同一个客户端生成的键也不会互相命中。

-- ---------------------------------------------------------------------------
-- staff_session：登录后页头要显示"你在哪一场"。
-- ---------------------------------------------------------------------------
create or replace function staff_session(p_staff_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events;
begin
  v_event := _event_by('staff', p_staff_key);
  return jsonb_build_object(
    'event_id', v_event.id,
    'title', v_event.title,
    'phase', v_event.phase,
    'org', (select jsonb_build_object('slug', o.slug, 'name_zh', o.name_zh, 'name_en', o.name_en)
            from organizations o where o.id = v_event.org_id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- staff_lookup：按编号批量查玩家（登录页拿空数组做一次校验）。
-- ---------------------------------------------------------------------------
create or replace function staff_lookup(p_staff_key text, p_codes text[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events;
  v_code text;
  v_player players;
  v_out jsonb := '[]'::jsonb;
begin
  v_event := _event_by('staff', p_staff_key);
  foreach v_code in array coalesce(p_codes, '{}') loop
    select * into v_player from players
    where event_id = v_event.id and code = v_code and not is_removed;
    if not found then
      v_out := v_out || jsonb_build_object('code', v_code, 'found', false);
    else
      v_out := v_out || (jsonb_build_object('found', true) || _player_json(v_player)
        || jsonb_build_object(
          'attempted_station_ids', coalesce((select jsonb_agg(station_id) from attempts
            where player_id = v_player.id and status in ('passed', 'failed')), '[]'::jsonb),
          'retry_station_ids', coalesce((select jsonb_agg(station_id) from attempts
            where player_id = v_player.id and status = 'retry_granted'), '[]'::jsonb),
          'failed_station_ids', coalesce((select jsonb_agg(a.station_id) from attempts a
            where a.player_id = v_player.id and a.status = 'failed'
              and not exists (select 1 from attempts r where r.player_id = a.player_id
                              and r.station_id = a.station_id and r.status = 'retry_granted')), '[]'::jsonb)));
    end if;
  end loop;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- staff_lookup_team：任一队员编号 → 整队
-- ---------------------------------------------------------------------------
create or replace function staff_lookup_team(p_staff_key text, p_identifier text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events;
  v_team_id uuid;
  v_team teams;
  v_ident text := trim(coalesce(p_identifier, ''));
begin
  v_event := _event_by('staff', p_staff_key);
  select t.id into v_team_id from teams t
  where t.event_id = v_event.id and upper(t.code) = upper(v_ident) limit 1;
  if v_team_id is null then
    select p.team_id into v_team_id from players p
    where p.event_id = v_event.id and p.code = v_ident and not p.is_removed limit 1;
  end if;
  if v_team_id is null then
    return jsonb_build_object('found', false, 'identifier', v_ident);
  end if;
  select * into v_team from teams where id = v_team_id;
  return jsonb_build_object(
    'found', true,
    'phase', v_event.phase,
    'event_title', v_event.title,
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
-- award_team_score：整队一次记分
-- ---------------------------------------------------------------------------
create or replace function award_team_score(p_staff_key text, p_identifier text, p_station_id integer, p_score integer, p_failed boolean, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events;
  v_idem text;
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
  v_event := _event_by('staff', p_staff_key);
  if p_idempotency_key is null or p_idempotency_key = '' then raise exception 'MISSING_IDEMPOTENCY_KEY'; end if;
  v_idem := v_event.id::text || ':' || p_idempotency_key;
  select result into v_prev from rpc_results where idempotency_key = v_idem;
  if found then return v_prev; end if;
  if v_event.phase <> 'playing' then raise exception 'GAME_NOT_PLAYING'; end if;

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
      where team_id = v_team.id and station_id = p_station_id and status in ('passed','failed') limit 1;
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
    if v_station.scoring_mode = 'free' and (p_score is null or p_score < 0 or p_score > 10) then raise exception 'BAD_TEAM_SCORE'; end if;
    if v_station.scoring_mode = 'fixed' and p_score is distinct from 6 then raise exception 'BAD_TEAM_SCORE'; end if;
    v_award := p_score; v_status := 'passed';
  end if;

  insert into team_attempts (event_id, team_id, station_id, score, status, scored_by, idempotency_key)
  values (v_event.id, v_team.id, p_station_id, v_award, v_status, 'staff', v_idem);
  update teams set challenge_score = greatest(0, challenge_score - v_previous_award + v_award)
  where id = v_team.id returning * into v_team;

  for v_player in select * from players where team_id = v_team.id and not is_removed order by id for update loop
    insert into attempts (event_id, player_id, station_id, score, status, scored_by, idempotency_key)
    values (v_event.id, v_player.id, p_station_id, v_award, v_status, 'team:' || v_team.code,
            v_idem || ':' || v_player.code);
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
  insert into rpc_results (event_id, idempotency_key, result) values (v_event.id, v_idem, v_prev);
  return v_prev;
end;
$$;

-- ---------------------------------------------------------------------------
-- use_team_token：整队求助（提示 / 重挑）
-- ---------------------------------------------------------------------------
create or replace function use_team_token(p_staff_key text, p_identifier text, p_usage_type text, p_station_id integer default null, p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events;
  v_idem text;
  v_prev jsonb;
  v_lookup jsonb;
  v_team teams;
  v_player players;
  v_members jsonb := '[]'::jsonb;
begin
  v_event := _event_by('staff', p_staff_key);
  if p_idempotency_key is not null and p_idempotency_key <> '' then
    v_idem := v_event.id::text || ':' || p_idempotency_key;
    select result into v_prev from rpc_results where idempotency_key = v_idem;
    if found then return v_prev; end if;
  end if;
  if v_event.phase <> 'playing' then raise exception 'GAME_NOT_PLAYING'; end if;
  if p_usage_type not in ('hint','second_chance') then raise exception 'BAD_USAGE_TYPE'; end if;
  v_lookup := staff_lookup_team(p_staff_key, p_identifier);
  if not coalesce((v_lookup ->> 'found')::boolean, false) then raise exception 'TEAM_NOT_FOUND:%', p_identifier; end if;
  select * into v_team from teams where id = (v_lookup ->> 'team_id')::uuid for update;
  if exists (select 1 from players where team_id = v_team.id and not is_removed and not token_available) then
    raise exception 'TEAM_TOKEN_INCOMPLETE:%', v_team.code;
  end if;
  if p_usage_type = 'second_chance' then
    if p_station_id is null then raise exception 'STATION_REQUIRED'; end if;
    if not exists (select 1 from stations where id = p_station_id and type = 'main') then raise exception 'BAD_STATION'; end if;
    if not exists (select 1 from team_attempts where team_id = v_team.id
      and station_id = p_station_id and status in ('passed','failed')) then
      raise exception 'TEAM_NOT_ATTEMPTED:%', v_team.code;
    end if;
    if exists (select 1 from team_attempts where team_id = v_team.id
      and station_id = p_station_id and status = 'retry_granted') then
      raise exception 'RETRY_ALREADY_GRANTED:%', v_team.code;
    end if;
    insert into team_attempts (event_id, team_id, station_id, status, scored_by)
    values (v_event.id, v_team.id, p_station_id, 'retry_granted', 'token');
  end if;
  for v_player in select * from players where team_id = v_team.id and not is_removed order by id for update loop
    update players set token_available = false where id = v_player.id;
    insert into token_usages (event_id, player_id, usage_type, target_station_id)
    values (v_event.id, v_player.id, p_usage_type, case when p_usage_type = 'second_chance' then p_station_id end);
    if p_usage_type = 'second_chance' then
      insert into attempts (event_id, player_id, station_id, score, status, scored_by)
      values (v_event.id, v_player.id, p_station_id, 0, 'retry_granted', 'token')
      on conflict do nothing;
    end if;
    v_members := v_members || jsonb_build_object('code', v_player.code, 'name', v_player.name);
  end loop;
  v_prev := jsonb_build_object('team_code', v_team.code, 'usage_type', p_usage_type,
    'target_station_id', p_station_id, 'members', v_members);
  if v_idem is not null then
    insert into rpc_results (event_id, idempotency_key, result) values (v_event.id, v_idem, v_prev);
  end if;
  return v_prev;
end;
$$;

-- ---------------------------------------------------------------------------
-- redeem_token_card：个人换纪念卡
-- ---------------------------------------------------------------------------
create or replace function redeem_token_card(p_staff_key text, p_player_code text, p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events;
  v_idem text;
  v_player players;
  v_result jsonb;
begin
  v_event := _event_by('staff', p_staff_key);
  if p_idempotency_key is not null and p_idempotency_key <> '' then
    v_idem := v_event.id::text || ':' || p_idempotency_key;
    select result into v_result from rpc_results where idempotency_key = v_idem;
    if found then return v_result; end if;
  end if;
  if v_event.phase = 'waiting' then raise exception 'CARD_REDEMPTION_NOT_OPEN'; end if;
  v_player := _get_player_locked(v_event.id, p_player_code);
  if not v_player.token_available then raise exception 'NO_TOKEN:%', p_player_code; end if;
  update players set token_available = false where id = v_player.id;
  insert into token_usages (event_id, player_id, usage_type) values (v_event.id, v_player.id, 'grace_card');
  v_result := jsonb_build_object('code', v_player.code, 'name', v_player.name, 'usage_type', 'grace_card');
  if v_idem is not null then
    insert into rpc_results (event_id, idempotency_key, result) values (v_event.id, v_idem, v_result)
    on conflict (idempotency_key) do nothing;
  end if;
  return v_result;
end;
$$;
