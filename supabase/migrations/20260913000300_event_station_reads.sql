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

-- _player_json 是内部函数，却从来没被收权——按 Postgres 默认对 PUBLIC 可执行。
-- 补上，和其它 _ 前缀的内部函数一致。
revoke execute on function _player_json(players) from public, anon, authenticated;

-- _award_stats / _team_stats：生效版本在 20260912000200_tenant_resolve.sql:245 和 :281
-- （Ruling 13：v_total 已经按本场启用主站算了，但这两个助手喂给它的 stations_done /
-- st_done 还是走全局 stations 表，既不看本场名册也不看 disabled_at——撤站后总数下调，
-- 完成数却仍把被撤站点的成绩算在内。改成跟 _main_stations_done 一样，按
-- (event_id, station_id) join event_stations 且 disabled_at is null。）
create or replace function _award_stats(p_event_id uuid)
returns table (
  player_id uuid, name text, color_group text, identity text, score int,
  joined_at timestamptz, ev_net int, ev_up int, ev_down int, ev_swing int, ev_count int,
  st_total int, st_nines int, st_done int, st_last timestamptz
)
language sql
stable
set search_path = public, pg_temp
as $$
  select p.id, p.name, p.color_group, p.identity, p.score, p.created_at,
         coalesce(e.net, 0)::int, coalesce(e.up, 0)::int, coalesce(e.down, 0)::int,
         coalesce(e.up - e.down, 0)::int, coalesce(e.n, 0)::int,
         coalesce(s.total, 0)::int, coalesce(s.nines, 0)::int, coalesce(s.done, 0)::int,
         s.last_at
  from players p
  left join (
    select le.player_id,
           sum(le.score_after - le.score_before) net,
           max(le.score_after - le.score_before) up,
           min(le.score_after - le.score_before) down,
           count(*) n
    from life_events le where le.event_id = p_event_id group by le.player_id
  ) e on e.player_id = p.id
  left join (
    select a.player_id, sum(a.score) total,
           count(*) filter (where a.score >= 9) nines,
           count(*) done, max(a.created_at) last_at
    from attempts a join event_stations st2 on st2.event_id = a.event_id and st2.station_id = a.station_id
    where a.event_id = p_event_id and st2.type = 'main' and st2.disabled_at is null and a.status in ('passed', 'failed')
    group by a.player_id
  ) s on s.player_id = p.id
  where p.event_id = p_event_id and not p.is_removed;
$$;

create or replace function _team_stats(p_event_id uuid)
returns table (
  team_id uuid, identity text, color_group text, members text, member_count int,
  created_at timestamptz, stations_done int, station_score int, nines int, last_at timestamptz
)
language sql
stable
set search_path = public, pg_temp
as $$
  select t.id, t.identity, t.color_group,
         coalesce((select string_agg(p.name, ' / ' order by p.created_at)
                   from players p where p.team_id = t.id and not p.is_removed), '—'),
         (select count(*)::int from players p where p.team_id = t.id and not p.is_removed),
         t.created_at,
         coalesce(a.done, 0)::int, coalesce(a.total, 0)::int, coalesce(a.nines, 0)::int, a.last_at
  from teams t
  left join (
    select ta.team_id, count(*) done, sum(ta.score) total,
           count(*) filter (where ta.score >= 9) nines, max(ta.created_at) last_at
    from team_attempts ta join event_stations s on s.event_id = ta.event_id and s.station_id = ta.station_id
    where ta.event_id = p_event_id and s.type = 'main' and s.disabled_at is null and ta.status in ('passed', 'failed')
    group by ta.team_id
  ) a on a.team_id = t.id
  where t.event_id = p_event_id
    and exists (select 1 from players p where p.team_id = t.id and not p.is_removed);
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
        ) from team_attempts a join teams t on t.id = a.team_id
          join event_stations s on s.event_id = a.event_id and s.station_id = a.station_id
        where a.event_id = v_event.id and a.status in ('passed','failed')
        union all
        select u.created_at, jsonb_build_object(
          'id', 'u' || u.id, 'kind', 'token', 'name', p.name,
          'usage', u.usage_type, 'station', s.name_zh, 'at', u.created_at
        ) from token_usages u join players p on p.id = u.player_id
          left join event_stations s on s.event_id = u.event_id and s.station_id = u.target_station_id
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

-- _event_station_metrics：生效版本在 20260912000200_tenant_resolve.sql:480
-- （管理端的站点指标曾经数全局 stations 表，现在只列本场 event_stations；撤掉的
-- 站仍然列出，带一个 disabled 标记，而不是从列表里消失。event_stations 没有
-- slug 列，'id' 直接用 station_id。）
drop function if exists _current_station_metrics();
create or replace function _event_station_metrics(p_event_id uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  with active_teams as (select count(*)::numeric as count from teams where event_id = p_event_id)
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.station_id, 'station_id', s.station_id, 'name_zh', s.name_zh, 'type', s.type,
    'scoring_mode', s.scoring_mode, 'sort_order', s.sort_order,
    'disabled', s.disabled_at is not null,
    'visits', case
      when s.type = 'main' then
        (select count(*) from team_attempts a where a.event_id = p_event_id and a.station_id = s.station_id and a.status in ('passed','failed'))
      when s.type = 'life_event' then (select count(*) from life_events where event_id = p_event_id)
      else (select count(*) from token_usages where event_id = p_event_id)
    end,
    'passed', (select count(*) from team_attempts a where a.event_id = p_event_id and a.station_id = s.station_id and a.status = 'passed'),
    'failed', (select count(*) from team_attempts a where a.event_id = p_event_id and a.station_id = s.station_id and a.status = 'failed'),
    'score_awarded', coalesce((select sum(a.score) from team_attempts a where a.event_id = p_event_id and a.station_id = s.station_id and a.status = 'passed'), 0),
    'completion_pct', case when s.type <> 'main' or active_teams.count = 0 then 0 else round(
      (select count(distinct a.team_id)::numeric from team_attempts a
       where a.event_id = p_event_id and a.station_id = s.station_id and a.status in ('passed','failed')) / active_teams.count * 100, 1)
    end
  ) order by s.sort_order), '[]'::jsonb)
  from event_stations s cross join active_teams
  where s.event_id = p_event_id;
$$;

-- ---------------------------------------------------------------------------
-- 工作人员面：本场站点 + 记分校验
--
-- 「有哪些站点」现在是每场自己的事（event_stations），工作人员端必须照本场
-- 名册来，撤掉的站不能再记分。四个函数（staff_stations 是新的；staff_session /
-- award_team_score / use_team_token / redeem_token_card 逐字重贴，只改站点相关
-- 的那几行）：生效版本都在 20260912000400_tenant_staff_rpcs.sql。
-- ---------------------------------------------------------------------------

/* 本场启用的站点，按 sort_order 排。工作人员选站要用它，不能再直读 stations 表。 */
create or replace function staff_stations(p_staff_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_event events;
begin
  v_event := _event_by('staff', p_staff_key);
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', es.station_id, 'station_id', es.station_id, 'name_zh', es.name_zh,
      'type', es.type, 'scoring_mode', es.scoring_mode, 'sort_order', es.sort_order
    ) order by es.sort_order)
    from event_stations es
    where es.event_id = v_event.id and es.disabled_at is null), '[]'::jsonb);
end;
$$;

grant execute on function staff_stations(text) to anon;

-- staff_session：只加了一行 'stations'，其余逐字照抄。
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
            from organizations o where o.id = v_event.org_id),
    'stations', staff_stations(p_staff_key)
  );
end;
$$;

-- award_team_score：站点校验换成查 event_stations（本场启用 + type = main），
-- v_station stations 换成四个标量变量，其余逐字照抄。
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
  v_es_type text;
  v_es_mode text;
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
  select es.type, es.scoring_mode
    into v_es_type, v_es_mode
  from event_stations es
  where es.event_id = v_event.id and es.station_id = p_station_id and es.disabled_at is null;
  if not found or v_es_type <> 'main' then raise exception 'BAD_STATION'; end if;

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
    if v_es_mode = 'graded' and p_score not in (3,6,9) then raise exception 'BAD_TEAM_SCORE'; end if;
    if v_es_mode = 'free' and (p_score is null or p_score < 0 or p_score > 10) then raise exception 'BAD_TEAM_SCORE'; end if;
    if v_es_mode = 'fixed' and p_score is distinct from 6 then raise exception 'BAD_TEAM_SCORE'; end if;
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

-- use_team_token：second_chance 的 BAD_STATION 检查改成查本场 event_stations，
-- 其余逐字照抄（这里原本没有 v_station 变量，只是一句 exists 检查，不用碰 declare）。
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
    if not exists (select 1 from event_stations es where es.event_id = v_event.id
        and es.station_id = p_station_id and es.type = 'main' and es.disabled_at is null) then
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

-- redeem_token_card：本身不带 station_id，没有站点相关的行要改，逐字照抄
-- （只是跟着一起重贴，保持和上面三个函数同样的纪律）。
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

-- ---------------------------------------------------------------------------
-- Ruling 17：_event_activity 和 (A) 的 _team_stats / _award_stats 同一类问题——
-- 活动流里团队闯关的站点标签也是 join 全局 stations 表，本场改过的名字读不到，
-- 只能看见库里的旧名字。生效版本在 20260912000200_tenant_resolve.sql:508，
-- 只改取站点名那一处 join；这里没有 select slug（原文只用了 name_zh），不需要
-- 像 _event_station_metrics 那样处理 id/slug 字段。
--
-- 注意和 (A) 不同：这里故意不加 disabled_at is null 过滤。活动流是历史记录，
-- 撤站前发生的团队闯关本来就该继续显示，不能因为站点后来被撤就从流水里消失。
-- ---------------------------------------------------------------------------
drop function if exists _current_activity(integer);
create or replace function _event_activity(p_event_id uuid, p_limit integer default 40)
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
                                from players p where p.team_id = t.id and not p.is_removed), '—'),
        'player_code', null, 'label', s.name_zh,
        'detail', case when a.status = 'passed' then '全队每人 +' || a.score || ' 分' else '本队本次未得分' end
      ) item
      from team_attempts a join teams t on t.id = a.team_id
        join event_stations s on s.event_id = a.event_id and s.station_id = a.station_id
      where a.event_id = p_event_id and a.status in ('passed','failed')
      union all
      select e.created_at, jsonb_build_object(
        'id', 'event-' || e.id, 'kind', 'life_event', 'at', e.created_at,
        'player_name', p.name, 'player_code', p.code,
        'label', coalesce(e.scene_title, '人生事件'), 'detail', e.card_label
      ) from life_events e join players p on p.id = e.player_id
      where e.event_id = p_event_id and not p.is_removed
      union all
      select u.created_at, jsonb_build_object(
        'id', 'token-' || u.id, 'kind', 'token', 'at', u.created_at,
        'player_name', p.name, 'player_code', p.code, 'label', 'Help Token', 'detail', u.usage_type
      ) from token_usages u join players p on p.id = u.player_id
      where u.event_id = p_event_id and not p.is_removed
      union all
      select aa.created_at, jsonb_build_object(
        'id', 'admin-' || aa.id, 'kind', 'admin', 'at', aa.created_at,
        'player_name', p.name, 'player_code', p.code, 'label', '管理员操作', 'detail', coalesce(aa.reason, aa.action)
      ) from admin_actions aa left join players p on p.id = aa.player_id
      where aa.event_id = p_event_id
    ) activity_union order by occurred_at desc
    limit greatest(1, least(coalesce(p_limit, 40), 200))
  ) recent;
$$;
