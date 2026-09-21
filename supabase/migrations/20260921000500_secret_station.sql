-- 月圆时刻与隐藏 NPC：隐藏摊位就是一个站点。
--
-- 站点库与本场快照各加两列：hidden（隐藏摊位）、hint（集齐主摊位后给玩家看的提示）。
-- 隐藏摊位 type 仍是 main、scoring_mode 固定 fixed（+6 只进 players.score，进领奖台），
-- 但所有「主摊位数量 / 进度 / 满分 / 最快」的口径都排除 hidden：
--   _main_station_total / _main_stations_done / _award_stats / _team_stats、
--   board_snapshot 的 stations_total 与每人 stations_done、poll_player_by_link 的 stations 列表。
-- 义工登录后 staff_stations 照常列出并标 hidden；大屏 feed 里隐藏摊位的记分 station 为 null、
-- secret 为 true；poll_player_by_link 顶层多一个 full_moon: {reached, hint, secret_done}。

alter table stations add column hidden boolean not null default false;
alter table stations add column hint text;
alter table event_stations add column hidden boolean not null default false;
alter table event_stations add column hint text;
comment on column stations.hidden is '隐藏摊位（神秘嘉宾）：不计入主摊位数量与进度，义工页可见，玩家集齐主摊位后才看到提示。';
comment on column stations.hint is '集齐主摊位后给玩家看的提示文案。';

-- ---------------------------------------------------------------------------
-- 进度口径：排除 hidden
-- ---------------------------------------------------------------------------

-- 源：20260913000300_event_station_reads.sql
create or replace function _main_station_total(p_event_id uuid)
returns int
language sql
stable
set search_path = public, pg_temp
as $$
  select greatest(count(*)::int, 1) from event_stations
  where event_id = p_event_id and type = 'main' and not hidden and disabled_at is null;
$$;

-- 源：20260913000300_event_station_reads.sql
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
    and not es.hidden
    and es.disabled_at is null;
$$;

-- 源：20260921000300_award_pool.sql
create or replace function _award_stats(p_event_id uuid)
returns table (
  player_id uuid, name text, color_group text, identity text, score int,
  joined_at timestamptz, ev_net int, ev_up int, ev_down int, ev_swing int, ev_count int,
  st_total int, st_nines int, st_done int, st_last timestamptz,
  team_id uuid, min_after int, grace_score int, is_solo boolean
)
language sql
stable
set search_path = public, pg_temp
as $$
  select p.id, p.name, p.color_group, p.identity, p.score, p.created_at,
         coalesce(e.net, 0)::int, coalesce(e.up, 0)::int, coalesce(e.down, 0)::int,
         coalesce(e.up - e.down, 0)::int, coalesce(e.n, 0)::int,
         coalesce(s.total, 0)::int, coalesce(s.nines, 0)::int, coalesce(s.done, 0)::int,
         s.last_at,
         p.team_id, e.min_after::int,
         (select max(a.score) from token_usages tu
            join attempts a on a.player_id = tu.player_id and a.station_id = tu.target_station_id
                           and a.status = 'passed' and a.created_at > tu.created_at
          where tu.player_id = p.id and tu.usage_type = 'second_chance')::int,
         p.identity = 'solo'
  from players p
  left join (
    select le.player_id,
           sum(le.score_after - le.score_before) net,
           max(le.score_after - le.score_before) up,
           min(le.score_after - le.score_before) down,
           count(*) n,
           min(le.score_after) min_after
    from life_events le where le.event_id = p_event_id group by le.player_id
  ) e on e.player_id = p.id
  left join (
    select a.player_id, sum(a.score) total,
           count(*) filter (where a.score >= 9) nines,
           count(*) done, max(a.created_at) last_at
    from attempts a join event_stations st2 on st2.event_id = a.event_id and st2.station_id = a.station_id
    where a.event_id = p_event_id and st2.type = 'main' and not st2.hidden and st2.disabled_at is null and a.status in ('passed', 'failed')
    group by a.player_id
  ) s on s.player_id = p.id
  where p.event_id = p_event_id and not p.is_removed;
$$;

-- 源：20260913000300_event_station_reads.sql
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
    where ta.event_id = p_event_id and s.type = 'main' and not s.hidden and s.disabled_at is null and ta.status in ('passed', 'failed')
    group by ta.team_id
  ) a on a.team_id = t.id
  where t.event_id = p_event_id
    and exists (select 1 from players p where p.team_id = t.id and not p.is_removed);
$$;

-- ---------------------------------------------------------------------------
-- 快照与站点库：hidden / hint 跟着走
-- ---------------------------------------------------------------------------

-- 源：20260913000200_event_station_rpcs.sql（insert 列表加 hidden, hint）
create or replace function _seed_event_stations(p_org_id uuid, p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev uuid;
  v_copied int := 0;
begin
  select e.id into v_prev from events e
  where e.org_id = p_org_id and e.id <> p_event_id
  order by e.created_at desc limit 1;

  if v_prev is not null then
    insert into event_stations (event_id, station_id, name_zh, type, scoring_mode, sort_order, hidden, hint)
    select p_event_id, es.station_id, es.name_zh, es.type, es.scoring_mode, es.sort_order, es.hidden, es.hint
    from event_stations es where es.event_id = v_prev;
    get diagnostics v_copied = row_count;
  end if;

  -- 上一场存在但名册空（比如它自己也是从空名册来的边缘场次）时，别忠实地复制出 0 个站：
  -- 兜底回到平台内置的 9 个，保证每场都至少有齐全的默认配置。
  if v_prev is null or v_copied = 0 then
    insert into event_stations (event_id, station_id, name_zh, type, scoring_mode, sort_order, hidden, hint)
    select p_event_id, s.id, s.name_zh, s.type, s.scoring_mode, s.sort_order, s.hidden, s.hint
    from stations s where s.org_id is null;
  end if;
end;
$$;

-- 源：20260913000200_event_station_rpcs.sql（加 p_hidden / p_hint；hidden 强制 main + fixed）
drop function if exists admin_library_create(text, text, text, text);
create or replace function admin_library_create(p_admin_key text, p_name_zh text, p_type text, p_scoring_mode text default null,
                                                p_hidden boolean default false, p_hint text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org organizations;
  v_name text := trim(coalesce(p_name_zh, ''));
  v_hidden boolean := coalesce(p_hidden, false);
  v_row stations;
begin
  v_org := _org_by_admin_key(p_admin_key);
  if length(v_name) < 1 or length(v_name) > 30 then raise exception 'BAD_STATION_NAME'; end if;
  if p_type not in ('main', 'life_event', 'grace') then raise exception 'BAD_STATION_TYPE'; end if;
  if v_hidden and p_type <> 'main' then raise exception 'BAD_STATION_TYPE'; end if;
  if p_type = 'main' and not v_hidden and coalesce(p_scoring_mode, '') not in ('graded', 'free', 'fixed') then
    raise exception 'BAD_SCORING_MODE';
  end if;
  insert into stations (org_id, slug, name_zh, type, scoring_mode, sort_order, hidden, hint)
  values (v_org.id, v_org.slug || '-' || left(md5(gen_random_uuid()::text), 6), v_name, p_type,
          case when v_hidden then 'fixed' when p_type = 'main' then p_scoring_mode else null end,
          coalesce((select max(sort_order) + 1 from stations where org_id = v_org.id), 100),
          v_hidden, case when v_hidden then nullif(trim(coalesce(p_hint, '')), '') end)
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

-- p_hidden 为 null 时保持原值；p_hint 为 null 时保持原值。不再隐藏时 hint 清空。
drop function if exists admin_library_update(text, integer, text, text, integer);
create or replace function admin_library_update(p_admin_key text, p_station_id integer, p_name_zh text, p_scoring_mode text default null,
                                                p_sort_order integer default null, p_hidden boolean default null, p_hint text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org organizations;
  v_row stations;
  v_name text := trim(coalesce(p_name_zh, ''));
  v_hidden boolean;
begin
  v_org := _org_by_admin_key(p_admin_key);
  select * into v_row from stations where id = p_station_id;
  if not found then raise exception 'BAD_STATION'; end if;
  if v_row.org_id is distinct from v_org.id then raise exception 'FORBIDDEN'; end if;
  if length(v_name) < 1 or length(v_name) > 30 then raise exception 'BAD_STATION_NAME'; end if;
  v_hidden := coalesce(p_hidden, v_row.hidden);
  if v_hidden and v_row.type <> 'main' then raise exception 'BAD_STATION_TYPE'; end if;
  if v_row.type = 'main' and not v_hidden and coalesce(p_scoring_mode, '') not in ('graded', 'free', 'fixed') then
    raise exception 'BAD_SCORING_MODE';
  end if;
  update stations set
    name_zh = v_name,
    scoring_mode = case when v_hidden then 'fixed' when type = 'main' then p_scoring_mode else null end,
    sort_order = coalesce(p_sort_order, sort_order),
    hidden = v_hidden,
    hint = case when not v_hidden then null
                when p_hint is null then hint
                else nullif(trim(p_hint), '') end
  where id = p_station_id returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

grant execute on function admin_library_create(text, text, text, text, boolean, text),
  admin_library_update(text, integer, text, text, integer, boolean, text) to anon;

-- 源：20260913000200_event_station_rpcs.sql（快照带 hidden / hint；隐藏摊位 scoring_mode 固定 fixed）
create or replace function admin_set_event_stations(p_admin_key text, p_event_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events;
  v_row jsonb;
  v_station stations;
  v_keep int[] := '{}';
  v_main int := 0;
  v_life int := 0;
begin
  v_event := _org_event(p_admin_key, p_event_id);
  if v_event.phase = 'ended' then raise exception 'EVENT_ENDED'; end if;
  if v_event.phase <> 'waiting' then raise exception 'EVENT_IN_PROGRESS'; end if;

  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    select * into v_station from stations where id = (v_row ->> 'station_id')::int;
    if not found then raise exception 'BAD_STATION'; end if;
    if v_station.org_id is not null and v_station.org_id <> v_event.org_id then raise exception 'FORBIDDEN'; end if;
    if length(trim(coalesce(v_row ->> 'name_zh', ''))) not between 1 and 30 then raise exception 'BAD_STATION_NAME'; end if;
    if v_station.type = 'main' then
      if not v_station.hidden and coalesce(v_row ->> 'scoring_mode', '') not in ('graded', 'free', 'fixed') then raise exception 'BAD_SCORING_MODE'; end if;
      -- 隐藏摊位不算主站数量：至少要留一个看得见的主站。
      if not v_station.hidden then v_main := v_main + 1; end if;
    elsif v_station.type = 'life_event' then
      v_life := v_life + 1;
    end if;
    v_keep := v_keep || v_station.id;

    insert into event_stations (event_id, station_id, name_zh, type, scoring_mode, sort_order, disabled_at, hidden, hint)
    values (p_event_id, v_station.id, trim(v_row ->> 'name_zh'), v_station.type,
            case when v_station.hidden then 'fixed' when v_station.type = 'main' then v_row ->> 'scoring_mode' else null end,
            coalesce((v_row ->> 'sort_order')::int, 0), null, v_station.hidden, v_station.hint)
    on conflict (event_id, station_id) do update
      set name_zh = excluded.name_zh, scoring_mode = excluded.scoring_mode,
          sort_order = excluded.sort_order, disabled_at = null,
          hidden = excluded.hidden, hint = excluded.hint;
  end loop;

  if v_life < 1 then raise exception 'LIFE_EVENT_REQUIRED'; end if;
  if v_main < 1 then raise exception 'MAIN_STATION_REQUIRED'; end if;

  if exists (select 1 from team_attempts ta where ta.event_id = p_event_id and not (ta.station_id = any (v_keep))) then
    raise exception 'STATION_IN_USE';
  end if;
  delete from event_stations where event_id = p_event_id and not (station_id = any (v_keep));

  return admin_event_stations(p_admin_key, p_event_id);
end;
$$;

grant execute on function admin_set_event_stations(text, uuid, jsonb) to anon;

-- ---------------------------------------------------------------------------
-- 读侧：义工看得到并标 hidden；大屏 feed 只留悬念；玩家卡多一个 full_moon
-- ---------------------------------------------------------------------------

-- 源：20260913000300_event_station_reads.sql（只加 'hidden'）
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
      'type', es.type, 'scoring_mode', es.scoring_mode, 'sort_order', es.sort_order,
      'hidden', es.hidden
    ) order by es.sort_order)
    from event_stations es
    where es.event_id = v_event.id and es.disabled_at is null), '[]'::jsonb);
end;
$$;

grant execute on function staff_stations(text) to anon;

-- 源：20260921000100_event_theme.sql（只改 feed 里 attempt 条目的 station / secret 两个键）
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
    'theme', v_event.theme,
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
          -- 隐藏摊位只留悬念：不报摊位名，标 secret。
          'station', case when s.hidden then null else s.name_zh end, 'secret', s.hidden,
          'status', a.status, 'score', a.score, 'at', a.created_at
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

-- 源：20260921000100_event_theme.sql（stations 列表排除 hidden；顶层加 full_moon）
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
  v_held boolean;
  v_reached boolean;
begin
  v_event := _event_by('join', p_join_token);
  select * into v_player from players
  where event_id = v_event.id and code = p_code and not is_removed;
  if not found then
    perform _throttle_failed_attempt('player-code');
    raise exception 'PLAYER_NOT_FOUND:%', p_code;
  end if;
  v_held := _ranks_held(v_event);
  select count(*) + 1 into v_rank from players
  where event_id = v_event.id and not is_removed and score > v_player.score;
  select count(*) + 1 into v_team_rank from teams
  where event_id = v_event.id
    and challenge_score > coalesce((select challenge_score from teams where id = v_player.team_id), 0);
  -- 月圆：走完全部（不含隐藏的）主摊位。
  v_reached := _main_stations_done(v_event.id, v_player.id) >= _main_station_total(v_event.id);

  return jsonb_build_object(
    'phase', v_event.phase,
    'started_at', v_event.started_at,
    'title', v_event.title,
    'org', (select jsonb_build_object('slug', o.slug, 'name_zh', o.name_zh, 'name_en', o.name_en)
            from organizations o where o.id = v_event.org_id),
    -- 押后期间名次根本不离开数据库。
    'rank', case when v_held then null else v_rank end,
    'team_rank', case when v_held then null else v_team_rank end,
    'ranks_published', not v_held,
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
      from life_events e where e.player_id = v_player.id), '[]'::jsonb),
    -- 本场启用的站点，形状与 staff_stations 一致。护照的格子照这个画（不含隐藏摊位）。
    'stations', coalesce((select jsonb_agg(jsonb_build_object(
      'id', es.station_id, 'station_id', es.station_id, 'name_zh', es.name_zh,
      'type', es.type, 'scoring_mode', es.scoring_mode, 'sort_order', es.sort_order
      ) order by es.sort_order)
      from event_stations es
      where es.event_id = v_event.id and es.disabled_at is null and not es.hidden), '[]'::jsonb),
    'full_moon', jsonb_build_object(
      'reached', v_reached,
      'hint', case when v_reached then (select es.hint from event_stations es
                                        where es.event_id = v_event.id and es.hidden and es.disabled_at is null
                                        order by es.sort_order, es.station_id limit 1) end,
      'secret_done', exists (select 1 from attempts a
                             join event_stations es on es.event_id = a.event_id and es.station_id = a.station_id
                             where a.player_id = v_player.id and a.event_id = v_event.id
                               and es.hidden and a.status = 'passed'))
  ) || jsonb_build_object('theme', v_event.theme);
end;
$$;

grant execute on function board_snapshot(text), poll_player_by_link(text, text) to anon, authenticated;
