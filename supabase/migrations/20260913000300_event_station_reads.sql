-- Life Passport · 多租户阶段 2 · 进度与人生段按本场启用站点
--
-- 「主站点总数」和「已完成主站点数」曾经是全局的（数 stations 表）。现在一场可以
-- 只启用站点库里的一部分站点（event_stations，撤站不清历史成绩，只把
-- disabled_at 设为非空），所以这两个数必须按 event_id 各算各的。
--
-- 四个进度助手的签名全部加了 p_event_id：旧的无参 / 单参版本删掉，避免和新版本
-- 同名重载导致调用方选错函数。三个消费者（_player_json / _event_awards /
-- board_snapshot）以及会漏掉的第四个消费者 _sync_life_event，逐字重贴到本迁移，
-- 只改与站点数相关的那几行。

-- ---------------------------------------------------------------------------
-- 进度助手（新签名）
-- ---------------------------------------------------------------------------
drop function if exists _main_station_total();
drop function if exists _main_stations_done(uuid);
drop function if exists _stage_unlock_at(int);
drop function if exists _due_stage(uuid);

/* Total main stations in play for one event (event_stations, still enabled). */
create or replace function _main_station_total(p_event_id uuid)
returns int
language sql
stable
set search_path = public, pg_temp
as $$
  select greatest(count(*)::int, 1) from event_stations
  where event_id = p_event_id and type = 'main' and disabled_at is null;
$$;

/* Completed main stations for one passport, in one event. A station that has
   since been disabled for the event no longer counts, even though the
   attempt/team_attempt row stays on record. */
create or replace function _main_stations_done(p_event_id uuid, p_player_id uuid)
returns int
language sql
stable
set search_path = public, pg_temp
as $$
  select count(*)::int
  from attempts a
  join event_stations es on es.event_id = a.event_id and es.station_id = a.station_id
  where a.player_id = p_player_id
    and a.event_id = p_event_id
    and a.status in ('passed', 'failed')
    and es.type = 'main'
    and es.disabled_at is null;
$$;

/* Stations completed before stage N unlocks. Scales with the event's own
   station count so a smaller (or larger) roster still spreads three events
   sensibly and always lands the last one on the final station. */
create or replace function _stage_unlock_at(p_event_id uuid, p_stage int)
returns int
language sql
stable
set search_path = public, pg_temp
as $$
  select case p_stage
    when 1 then greatest(1, round(_main_station_total(p_event_id) * 3.0 / 7.0)::int)
    when 2 then greatest(2, round(_main_station_total(p_event_id) * 5.0 / 7.0)::int)
    when 3 then _main_station_total(p_event_id)
  end;
$$;

/* Highest stage a passport has earned the right to experience. Unchanged from
   the hybrid rule in 20260828081021_single_code_hybrid_stages.sql (a score
   gate OR a station-count gate, whichever a player reaches first) — only the
   two station-count calls get p_event_id. */
create or replace function _due_stage(p_event_id uuid, p_player_id uuid)
returns int
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(max(s), 0)
  from players p, generate_series(1, 3) s
  where p.id = p_player_id
    and (
      p.score >= _stage_score_gate(s)
      or _main_stations_done(p_event_id, p_player_id) >= _stage_unlock_at(p_event_id, s)
    );
$$;

-- New signatures default to PUBLIC execute; lock them back down like every
-- other internal helper.
revoke execute on function _main_station_total(uuid), _main_stations_done(uuid, uuid),
  _stage_unlock_at(uuid, int), _due_stage(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 重贴的调用方（逐字照抄生效版本，只改站点数相关的行）
-- ---------------------------------------------------------------------------

-- _player_json：生效版本在 20260828081021_single_code_hybrid_stages.sql:178
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
    -- Teammates replace the old short team code: a Duo/Trio identifies itself
    -- by who is standing there, and any member's own code resolves the team.
    'teammates', coalesce((select jsonb_agg(m.name order by m.created_at)
      from players m where m.team_id = p.team_id and not m.is_removed and m.id <> p.id), '[]'::jsonb),
    'stations_done', _main_stations_done(p.event_id, p.id),
    'stations_total', _main_station_total(p.event_id),
    'life_events_done', (select count(*)::int from life_event_instances i
                         where i.player_id = p.id and i.state = 'resolved'),
    'life_events_total', 3,
    'pending_stage', p.pending_stage,
    'next_event_stage', _next_stage(p.id),
    'next_event_after_station', (select _stage_unlock_at(p.event_id, _next_stage(p.id))),
    'next_event_score', (select _stage_score_gate(_next_stage(p.id)))
  );
$$;

-- _event_awards：生效版本在 20260912000200_tenant_resolve.sql:357
create or replace function _event_awards(p_event_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_podium jsonb := '[]'::jsonb;
  v_specials jsonb := '[]'::jsonb;
  v_team_awards jsonb := '[]'::jsonb;
  v_used uuid[] := '{}';
  v_row record;
  v_id uuid;
  v_stat record;
  v_team record;
  v_rank int := 0;
  v_total int := _main_station_total(p_event_id);
begin
  for v_row in
    select * from _award_stats(p_event_id) order by score desc, joined_at asc, player_id::text limit 3
  loop
    v_rank := v_rank + 1;
    v_podium := v_podium || jsonb_build_object(
      'rank', v_rank, 'name', v_row.name, 'score', v_row.score,
      'color_group', v_row.color_group, 'identity', v_row.identity,
      'stations_done', v_row.st_done, 'life_events', v_row.ev_count
    );
    v_used := v_used || v_row.player_id;
  end loop;

  for v_row in
    select * from (values
      ('ev_net > 0',                'ev_net',   true,  'lucky',         '🍀', '天选之子',   '人生事件加分最多'),
      ('ev_net < 0',                'ev_net',   false, 'unlucky',       '🌧️', '时运不济',   '人生事件扣分最多'),
      ('ev_up > 0 and ev_down < 0', 'ev_swing', true,  'rollercoaster', '🎢', '人生过山车', '同时经历了最高的加分和最重的扣分'),
      ('ev_count >= 2', 'ev_swing, abs(ev_net)', false, 'steady_heart', '🌊', '波澜不惊',   '经历过人生，却最稳得住')
    ) as t(qualify, metric, is_desc, key, emoji, title, subtitle)
  loop
    v_id := _pick_award(p_event_id, v_row.qualify, v_row.metric, v_row.is_desc, v_used);
    if v_id is null then continue; end if;
    select * into v_stat from _award_stats(p_event_id) where player_id = v_id;
    v_used := v_used || v_id;
    v_specials := v_specials || jsonb_build_object(
      'key', v_row.key, 'emoji', v_row.emoji, 'title', v_row.title, 'subtitle', v_row.subtitle,
      'name', v_stat.name, 'color_group', v_stat.color_group, 'identity', v_stat.identity,
      'score', v_stat.score,
      'caption', case v_row.key
        when 'lucky' then format('人生事件净赚 +%s 分', v_stat.ev_net)
        when 'unlucky' then format('人生事件净亏 %s 分', abs(v_stat.ev_net))
        when 'rollercoaster' then format('一次 +%s，一次 %s，落差 %s 分', v_stat.ev_up, v_stat.ev_down, v_stat.ev_swing)
        else format('三段人生上下不超过 %s 分', v_stat.ev_swing)
      end
    );
  end loop;

  v_id := _pick_team_award(p_event_id,
    'last_at is not null and stations_done >= ' || v_total, 'last_at', false, '{}'::uuid[]);
  if v_id is not null then
    select * into v_team from _team_stats(p_event_id) where team_id = v_id;
    v_team_awards := jsonb_build_array(jsonb_build_object(
      'key', 'fastest', 'emoji', '⚡', 'title', '最快通关', 'subtitle', '全场最先走完所有站点',
      'members', v_team.members, 'member_count', v_team.member_count,
      'identity', v_team.identity, 'color_group', v_team.color_group,
      'caption', format('全场第一个完成 %s 站', v_team.stations_done)
    ));
  end if;

  return jsonb_build_object('podium', v_podium, 'specials', v_specials, 'team_awards', v_team_awards);
end;
$$;

-- board_snapshot：生效版本在 20260912000300_tenant_player_rpcs.sql:268
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
    'stations_total', _main_station_total(v_event.id),
    'players', coalesce((select jsonb_agg(row_json order by sort_team, sort_created, sort_id) from (
      select coalesce(t.created_at, 'infinity'::timestamptz) sort_team,
             p.created_at sort_created, p.id::text sort_id,
             jsonb_build_object(
        'id', p.id, 'team_id', p.team_id, 'name', p.name,
        'member_count', (select count(*) from players m where m.team_id = p.team_id and not m.is_removed),
        'identity', p.identity, 'color_group', p.color_group, 'score', p.score,
        'locked', p.locked_for_life_event, 'token_available', p.token_available,
        'sick', (p.status_effect ->> 'type') = 'cap_next',
        'stations_done', _main_stations_done(v_event.id, p.id),
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

grant execute on function board_snapshot(text) to anon;

-- _sync_life_event：生效版本在 20260912000700_tenant_hardening.sql:26
-- （brief 漏列的第四个调用方——Ruling 2）
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
  if exists (select 1 from life_event_instances where player_id = p_player_id and state = 'pending') then
    return null; -- one pending event per player, by design
  end if;

  v_due := _due_stage(v_player.event_id, p_player_id);
  if v_due = 0 then return null; end if;

  select min(s) into v_stage from generate_series(1, v_due) s
  where not exists (select 1 from life_event_instances i
                    where i.player_id = p_player_id and i.stage = s);
  if v_stage is null then return null; end if;

  v_id := _create_event_for_player(v_player, v_stage, v_player.score);
  update players set locked_for_life_event = true, pending_stage = v_stage, pending_threshold = null
  where id = p_player_id;
  return v_id;
end;
$$;
