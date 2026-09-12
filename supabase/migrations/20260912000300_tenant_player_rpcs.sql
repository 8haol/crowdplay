-- Life Passport · 多租户阶段 1 · 玩家与大屏 RPC
-- 玩家凭 join_token、大屏凭 screen_token 定位场次。签名除 game_landing / board_snapshot 外不变。

-- ---------------------------------------------------------------------------
-- game_landing：玩家链接落地。找不到不抛错 —— 前端要用 invalid 渲染引导页。
-- ---------------------------------------------------------------------------
create or replace function game_landing(p_join_token text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v events;
begin
  if nullif(trim(coalesce(p_join_token, '')), '') is null then
    return jsonb_build_object('is_current', false, 'invalid', true, 'reason', 'NO_TOKEN');
  end if;
  select * into v from events where join_token = trim(p_join_token);
  if not found then
    return jsonb_build_object('is_current', false, 'invalid', true, 'reason', 'BAD_GAME_LINK');
  end if;
  return _session_json(v) || jsonb_build_object('is_current', v.phase <> 'ended');
end;
$$;

-- ---------------------------------------------------------------------------
-- join_by_link
-- ---------------------------------------------------------------------------
create or replace function join_by_link(p_name text, p_join_token text, p_contact text default null, p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events;
  v_name text := trim(coalesce(p_name, ''));
  v_contact text := nullif(trim(coalesce(p_contact, '')), '');
  v_idem text;
  v_previous jsonb;
  v_new record;
  v_team uuid;
  v_color text;
  v_result jsonb;
begin
  v_event := _event_by('join', p_join_token);
  -- 行锁串行化同一场的报名：两个并发重试不会各自漏看 rpc_results 而建出两行。
  select * into v_event from events where id = v_event.id for update;

  if v_event.phase = 'ended' then raise exception 'GAME_ARCHIVED'; end if;
  if not v_event.join_open then raise exception 'JOIN_CLOSED'; end if;
  if length(v_name) < 1 or length(v_name) > 20 then raise exception 'BAD_NAME'; end if;
  if v_contact is not null and length(v_contact) > 80 then raise exception 'BAD_CONTACT'; end if;

  if nullif(trim(coalesce(p_idempotency_key, '')), '') is not null then
    v_idem := 'join:' || v_event.id::text || ':' || trim(p_idempotency_key);
    select result into v_previous from rpc_results where idempotency_key = v_idem;
    if found then return v_previous; end if;
  end if;

  select * into v_new from _new_player_code(v_event.id, v_name);
  update players set contact = v_contact where id = v_new.player_id;

  -- 开局后来的人自成一个 Solo 队，不打扰已经在闯关的 Duo / Trio。
  if v_event.phase = 'playing' then
    v_color := 'solo-' || (((select count(*) from teams where event_id = v_event.id and identity = 'solo') % 8) + 1)::text;
    v_team := _make_team(v_event.id, 'solo', v_color);
    update players set identity = 'solo', color_group = v_color, team_id = v_team
    where id = v_new.player_id;
  end if;

  v_result := jsonb_build_object(
    'player_id', v_new.player_id,
    'code', v_new.code,
    'event_id', v_event.id,
    'title', v_event.title
  );
  if v_idem is not null then
    insert into rpc_results (event_id, idempotency_key, result) values (v_event.id, v_idem, v_result);
  end if;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- poll_player_by_link：护照页 3 秒轮询。名次只在本场内算。
-- ---------------------------------------------------------------------------
create or replace function poll_player_by_link(p_join_token text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events;
  v_player players;
  v_rank int;
  v_team_rank int;
begin
  v_event := _event_by('join', p_join_token);
  select * into v_player from players
  where event_id = v_event.id and code = p_code and not is_removed;
  if not found then
    perform _throttle_failed_attempt('player-code');
    raise exception 'PLAYER_NOT_FOUND:%', p_code;
  end if;
  select count(*) + 1 into v_rank from players
  where event_id = v_event.id and not is_removed and score > v_player.score;
  select count(*) + 1 into v_team_rank from teams
  where event_id = v_event.id
    and challenge_score > coalesce((select challenge_score from teams where id = v_player.team_id), 0);

  return jsonb_build_object(
    'phase', v_event.phase,
    'started_at', v_event.started_at,
    'title', v_event.title,
    'org', (select jsonb_build_object('slug', o.slug, 'name_zh', o.name_zh, 'name_en', o.name_en)
            from organizations o where o.id = v_event.org_id),
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
      'card_type', e.card_type, 'card_label', e.card_label, 'stage', e.stage,
      'scene_title', e.scene_title, 'choice_label', e.choice_label,
      'outcome_detail', e.outcome_detail,
      'score_before', e.score_before, 'score_after', e.score_after,
      'created_at', e.created_at) order by e.created_at)
      from life_events e where e.player_id = v_player.id), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- recover_by_link：找回护照。需要本场链接 + 编号两样，缺一不可。
-- ---------------------------------------------------------------------------
create or replace function recover_by_link(p_join_token text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events;
  v players;
begin
  v_event := _event_by('join', p_join_token);
  select * into v from players where event_id = v_event.id and code = p_code and not is_removed;
  if not found then
    perform _throttle_failed_attempt('recover_identity');
    raise exception 'PLAYER_NOT_FOUND:%', p_code;
  end if;
  return _player_json(v);
end;
$$;

-- ---------------------------------------------------------------------------
-- choose_life_event_by_link
-- ---------------------------------------------------------------------------
create or replace function choose_life_event_by_link(p_join_token text, p_player_code text, p_event_id uuid, p_choice_key text, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events;
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
  v_event := _event_by('join', p_join_token);
  if v_event.phase <> 'playing' then raise exception 'GAME_NOT_PLAYING'; end if;
  select * into v_player from players
  where event_id = v_event.id and code = p_player_code and not is_removed for update;
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
    event_id, player_id, threshold, stage, card_type, card_label, score_before, score_after,
    scene_key, scene_title, choice_key, choice_label, outcome_key, outcome_detail
  ) values (
    v_event.id, v_player.id, null, v_instance.stage,
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

  v_next_event := _sync_life_event(v_player.id);
  v_result := v_result || jsonb_build_object(
    'next_event_stage', _next_stage(v_player.id),
    'next_pending_event_id', v_next_event
  );
  update life_event_instances set result_snapshot = v_result where id = v_instance.id;

  if p_idempotency_key is not null and p_idempotency_key <> '' then
    insert into rpc_results (event_id, idempotency_key, result)
    values (v_event.id, v_event.id::text || ':' || p_idempotency_key, v_result)
    on conflict (idempotency_key) do nothing;
  end if;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- board_snapshot：大屏。一次调用带回场次标题、入场链接和机构名，
-- 投影页不再需要第二个轮询。仍然不含任何人生编号。
-- ---------------------------------------------------------------------------
drop function if exists board_snapshot();
create or replace function board_snapshot(p_screen_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events;
begin
  v_event := _event_by('screen', p_screen_token);
  return jsonb_build_object(
    'event_id', v_event.id,
    'title', v_event.title,
    'join_token', v_event.join_token,
    'join_open', v_event.join_open,
    'org', (select jsonb_build_object('slug', o.slug, 'name_zh', o.name_zh, 'name_en', o.name_en)
            from organizations o where o.id = v_event.org_id),
    'phase', v_event.phase, 'started_at', v_event.started_at,
    'stations_total', _main_station_total(),
    'players', coalesce((select jsonb_agg(row_json order by sort_team, sort_created, sort_id) from (
      select coalesce(t.created_at, 'infinity'::timestamptz) sort_team,
             p.created_at sort_created, p.id::text sort_id,
             jsonb_build_object(
        'id', p.id, 'team_id', p.team_id, 'name', p.name,
        'member_count', (select count(*) from players m where m.team_id = p.team_id and not m.is_removed),
        'identity', p.identity, 'color_group', p.color_group, 'score', p.score,
        'locked', p.locked_for_life_event, 'token_available', p.token_available,
        'sick', (p.status_effect ->> 'type') = 'cap_next',
        'stations_done', _main_stations_done(p.id),
        'life_events_done', (select count(*) from life_event_instances i
                             where i.player_id = p.id and i.state = 'resolved')
      ) row_json
      from players p left join teams t on t.id = p.team_id
      where p.event_id = v_event.id and not p.is_removed
    ) personal_board), '[]'::jsonb),
    'stats', jsonb_build_object(
      'players', (select count(*) from players where event_id = v_event.id and not is_removed),
      'teams', (select count(*) from teams where event_id = v_event.id),
      'stamps', (select count(*) from team_attempts where event_id = v_event.id and status in ('passed','failed')),
      'life_events', (select count(*) from life_events where event_id = v_event.id),
      'tokens_used', (select count(*) from token_usages where event_id = v_event.id),
      'top_score', coalesce((select max(score) from players where event_id = v_event.id and not is_removed), 0)
    ),
    'awards', case when v_event.phase = 'ended' then _event_awards(v_event.id) end,
    'feed', coalesce((select jsonb_agg(item order by created_at desc) from (
      select created_at, item from (
        select e.created_at, jsonb_build_object(
          'id', 'e' || e.id, 'kind', 'life_event', 'name', p.name,
          'card', e.card_type, 'label', e.card_label,
          'scene', e.scene_title, 'choice', e.choice_label, 'outcome', e.card_label,
          'stage', e.stage, 'before', e.score_before, 'after', e.score_after, 'at', e.created_at
        ) item from life_events e join players p on p.id = e.player_id
        where e.event_id = v_event.id and not p.is_removed
        union all
        select a.created_at, jsonb_build_object(
          'id', 'ta' || a.id, 'kind', 'attempt',
          'name', coalesce((select string_agg(p.name, ' / ' order by p.created_at)
                            from players p where p.team_id = t.id and not p.is_removed), '—'),
          'color_group', t.color_group, 'identity', t.identity,
          'station', s.name_zh, 'status', a.status, 'score', a.score, 'at', a.created_at
        ) from team_attempts a join teams t on t.id = a.team_id join stations s on s.id = a.station_id
        where a.event_id = v_event.id and a.status in ('passed','failed')
        union all
        select u.created_at, jsonb_build_object(
          'id', 'u' || u.id, 'kind', 'token', 'name', p.name,
          'usage', u.usage_type, 'station', s.name_zh, 'at', u.created_at
        ) from token_usages u join players p on p.id = u.player_id
          left join stations s on s.id = u.target_station_id
        where u.event_id = v_event.id and not p.is_removed
      ) feed_union order by created_at desc limit 60
    ) recent), '[]'::jsonb)
  );
end;
$$;
