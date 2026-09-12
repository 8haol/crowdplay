-- Life Passport · 多租户阶段 1 · 令牌解析与场次内部函数
--
-- 核心规则：每个 RPC 拿到的第一个凭证本身决定它在哪一场操作。
--   玩家   p_join_token   → _event_by('join', …)
--   工作人员 p_staff_key  → _event_by('staff', …)
--   大屏   p_screen_token → _event_by('screen', …)
--   管理员 p_admin_key + p_event_id → _org_event(…)
-- 其余内部函数一律显式收 p_event_id，不再有"当前场"这个隐含概念。

-- ---------------------------------------------------------------------------
-- 1. 解析器
-- ---------------------------------------------------------------------------
create or replace function _event_by(p_kind text, p_token text)
returns events
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v events;
  v_token text := trim(coalesce(p_token, ''));
begin
  if v_token = '' then
    raise exception '%', case p_kind when 'join' then 'BAD_GAME_LINK'
                                     when 'staff' then 'BAD_STAFF_KEY'
                                     else 'BAD_SCREEN_TOKEN' end;
  end if;
  case p_kind
    when 'join'   then select * into v from events where join_token = v_token;
    when 'staff'  then select * into v from events where staff_code = upper(v_token);
    when 'screen' then select * into v from events where screen_token = v_token;
    else raise exception 'BAD_TOKEN_KIND';
  end case;
  if not found then
    -- 猜令牌的代价：每次失败都要等。工作人员码只有 32^6 ≈ 10 亿种，够用但不是无限。
    perform _throttle_failed_attempt(p_kind || '-token');
    raise exception '%', case p_kind when 'join' then 'BAD_GAME_LINK'
                                     when 'staff' then 'BAD_STAFF_KEY'
                                     else 'BAD_SCREEN_TOKEN' end;
  end if;
  return v;
end;
$$;

-- 机构管理密码 → 机构。密码是哈希存储，只能逐个比对；机构数量是个位数，无所谓。
create or replace function _org_by_admin_key(p_admin_key text)
returns organizations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v organizations;
begin
  select o.* into v from organizations o
  where _secret_matches(o.admin_key, p_admin_key)
  limit 1;
  if not found then
    perform _throttle_failed_attempt('admin-key');
    raise exception 'BAD_KEY';
  end if;
  return v;
end;
$$;

-- 管理员操作某一场：密码决定机构，再断言这一场属于它。
-- 不属于时报 EVENT_NOT_FOUND 而不是 FORBIDDEN —— 不向别的机构暴露场次是否存在。
create or replace function _org_event(p_admin_key text, p_event_id uuid)
returns events
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org organizations;
  v events;
begin
  v_org := _org_by_admin_key(p_admin_key);
  if p_event_id is null then raise exception 'EVENT_REQUIRED'; end if;
  select * into v from events where id = p_event_id and org_id = v_org.id;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  return v;
end;
$$;

-- 给玩家 / 大屏看的场次描述。没有任何密钥字段。
create or replace function _session_json(e events)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'event_id', e.id,
    'org_id', e.org_id,
    'title', e.title,
    'join_token', e.join_token,
    'join_open', e.join_open,
    'phase', e.phase,
    'created_at', e.created_at,
    'started_at', e.started_at,
    'ended_at', e.ended_at,
    'player_count', (select count(*) from players p where p.event_id = e.id and not p.is_removed),
    'org', (select jsonb_build_object('slug', o.slug, 'name_zh', o.name_zh, 'name_en', o.name_en)
            from organizations o where o.id = e.org_id)
  );
$$;

-- 给管理员看的：多出三把钥匙。只从 admin_* RPC 返回。
create or replace function _session_admin_json(e events)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select _session_json(e) || jsonb_build_object(
    'staff_code', e.staff_code,
    'screen_token', e.screen_token
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. 场次内部函数：签名统一加 p_event_id
-- ---------------------------------------------------------------------------
drop function if exists _get_player_locked(text);
create or replace function _get_player_locked(p_event_id uuid, p_code text)
returns players
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v players;
begin
  select * into v from players
  where event_id = p_event_id and code = p_code and not is_removed
  for update;
  if not found then raise exception 'PLAYER_NOT_FOUND:%', p_code; end if;
  return v;
end;
$$;

drop function if exists _new_player_code(text);
create or replace function _new_player_code(p_event_id uuid, p_name text)
returns table (player_id uuid, code text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text;
  v_id uuid;
  i int;
begin
  for i in 1..20 loop
    -- 直接从「合规且本场未用」的集合里抽；避讳规则见 _player_code_allowed。
    select pool.c into v_code
    from (select g::text as c from generate_series(100, 999) g) pool
    where _player_code_allowed(pool.c)
      and not exists (select 1 from players p where p.event_id = p_event_id and p.code = pool.c)
    order by random()
    limit 1;
    if v_code is null then raise exception 'CODE_POOL_EXHAUSTED'; end if;
    begin
      insert into players (event_id, name, code) values (p_event_id, p_name, v_code)
      returning players.id into v_id;
      player_id := v_id;
      code := v_code;
      return next;
      return;
    exception when unique_violation then
      v_id := null; -- 抽号和写入之间被另一个报名占走了，重抽
    end;
  end loop;
  raise exception 'CODE_POOL_EXHAUSTED';
end;
$$;

drop function if exists _make_team(text, text);
create or replace function _make_team(p_event_id uuid, p_identity text, p_color text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_prefix text := case p_identity when 'solo' then 'S' when 'duo' then 'D' else 'T' end;
  v_slot int;
begin
  select count(*) + 1 into v_slot from teams where event_id = p_event_id and identity = p_identity;
  insert into teams (event_id, code, identity, color_group)
  values (p_event_id, v_prefix || lpad(v_slot::text, 2, '0'), p_identity, p_color)
  returning id into v_id;
  return v_id;
end;
$$;

-- 人生事件实例：event_id 直接取自玩家行。
create or replace function _create_event_for_player(p_player players, p_stage integer, p_score integer)
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
    event_id, player_id, stage, scene_key, scene_snapshot, score_at_trigger
  ) values (
    p_player.event_id, p_player.id, p_stage,
    v_scene.key,
    jsonb_build_object('title', v_scene.title, 'prompt', v_scene.prompt,
                       'emoji', v_scene.emoji, 'choices', v_scene.choices),
    p_score
  ) returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. 统计 / 颁奖：全部按场次
-- ---------------------------------------------------------------------------
drop function if exists _award_stats();
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
    from attempts a join stations st2 on st2.id = a.station_id
    where a.event_id = p_event_id and st2.type = 'main' and a.status in ('passed', 'failed')
    group by a.player_id
  ) s on s.player_id = p.id
  where p.event_id = p_event_id and not p.is_removed;
$$;

drop function if exists _team_stats();
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
    from team_attempts ta join stations s on s.id = ta.station_id
    where ta.event_id = p_event_id and s.type = 'main' and ta.status in ('passed', 'failed')
    group by ta.team_id
  ) a on a.team_id = t.id
  where t.event_id = p_event_id
    and exists (select 1 from players p where p.team_id = t.id and not p.is_removed);
$$;

drop function if exists _pick_award(text, text, boolean, uuid[]);
create or replace function _pick_award(p_event_id uuid, p_qualify text, p_metric text, p_desc boolean, p_exclude uuid[])
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
    'select player_id from _award_stats($2) where %s and not (player_id = any($1))
     order by %s %s, joined_at asc, player_id::text limit 1', p_qualify, p_metric, v_dir)
  into v_id using coalesce(p_exclude, '{}'::uuid[]), p_event_id;
  if v_id is null then
    execute format(
      'select player_id from _award_stats($1) where %s order by %s %s, joined_at asc, player_id::text limit 1',
      p_qualify, p_metric, v_dir) into v_id using p_event_id;
  end if;
  return v_id;
end;
$$;

drop function if exists _pick_team_award(text, text, boolean, uuid[]);
create or replace function _pick_team_award(p_event_id uuid, p_qualify text, p_metric text, p_desc boolean, p_exclude uuid[])
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
    'select team_id from _team_stats($2) where %s and not (team_id = any($1))
     order by %s %s, created_at asc, team_id::text limit 1', p_qualify, p_metric, v_dir)
  into v_id using coalesce(p_exclude, '{}'::uuid[]), p_event_id;
  if v_id is null then
    execute format(
      'select team_id from _team_stats($1) where %s order by %s %s, created_at asc, team_id::text limit 1',
      p_qualify, p_metric, v_dir) into v_id using p_event_id;
  end if;
  return v_id;
end;
$$;

drop function if exists _event_awards();
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
  v_total int := _main_station_total();
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

-- ---------------------------------------------------------------------------
-- 4. 管理端明细：全部按场次
-- ---------------------------------------------------------------------------
drop function if exists _current_players_detail();
create or replace function _event_players_detail(p_event_id uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(
    _player_json(p.*) || jsonb_build_object(
      'contact', p.contact,
      'is_removed', p.is_removed,
      'created_at', p.created_at,
      'attempt_count', (select count(*) from attempts a where a.player_id = p.id and a.status in ('passed','failed')),
      'attempts', coalesce((select jsonb_agg(jsonb_build_object(
        'station_id', a.station_id, 'station_name', s.name_zh, 'status', a.status,
        'score', a.score, 'created_at', a.created_at
      ) order by a.created_at) from attempts a join stations s on s.id = a.station_id
        where a.player_id = p.id and a.status in ('passed','failed')), '[]'::jsonb),
      'life_events', coalesce((select jsonb_agg(jsonb_build_object(
        'card_type', e.card_type, 'card_label', e.card_label,
        'scene_title', e.scene_title, 'choice_label', e.choice_label,
        'outcome_detail', e.outcome_detail,
        'score_before', e.score_before, 'score_after', e.score_after,
        'created_at', e.created_at
      ) order by e.created_at) from life_events e where e.player_id = p.id), '[]'::jsonb),
      'token_usages', coalesce((select jsonb_agg(jsonb_build_object(
        'usage_type', u.usage_type, 'target_station_id', u.target_station_id, 'created_at', u.created_at
      ) order by u.created_at) from token_usages u where u.player_id = p.id), '[]'::jsonb)
    ) order by p.score desc, p.created_at
  ), '[]'::jsonb) from players p where p.event_id = p_event_id;
$$;

drop function if exists _current_teams_detail();
create or replace function _event_teams_detail(p_event_id uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(
    _team_json(t.id) || jsonb_build_object(
      'stations_done', (select count(*) from team_attempts a where a.team_id = t.id and a.status in ('passed','failed')),
      'pending_events', (select count(*) from players p where p.team_id = t.id and not p.is_removed and p.locked_for_life_event),
      'created_at', t.created_at
    ) order by t.created_at
  ), '[]'::jsonb) from teams t where t.event_id = p_event_id;
$$;

drop function if exists _current_station_metrics();
create or replace function _event_station_metrics(p_event_id uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  with active_teams as (select count(*)::numeric as count from teams where event_id = p_event_id)
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'slug', s.slug, 'name_zh', s.name_zh, 'type', s.type,
    'scoring_mode', s.scoring_mode, 'sort_order', s.sort_order,
    'visits', case
      when s.type = 'main' then
        (select count(*) from team_attempts a where a.event_id = p_event_id and a.station_id = s.id and a.status in ('passed','failed'))
      when s.type = 'life_event' then (select count(*) from life_events where event_id = p_event_id)
      else (select count(*) from token_usages where event_id = p_event_id)
    end,
    'passed', (select count(*) from team_attempts a where a.event_id = p_event_id and a.station_id = s.id and a.status = 'passed'),
    'failed', (select count(*) from team_attempts a where a.event_id = p_event_id and a.station_id = s.id and a.status = 'failed'),
    'score_awarded', coalesce((select sum(a.score) from team_attempts a where a.event_id = p_event_id and a.station_id = s.id and a.status = 'passed'), 0),
    'completion_pct', case when s.type <> 'main' or active_teams.count = 0 then 0 else round(
      (select count(distinct a.team_id)::numeric from team_attempts a
       where a.event_id = p_event_id and a.station_id = s.id and a.status in ('passed','failed')) / active_teams.count * 100, 1)
    end
  ) order by s.sort_order), '[]'::jsonb)
  from stations s cross join active_teams;
$$;

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
      from team_attempts a join teams t on t.id = a.team_id join stations s on s.id = a.station_id
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

-- ---------------------------------------------------------------------------
-- 5. 权限：内部函数一律不给 anon
-- ---------------------------------------------------------------------------
revoke execute on function
  _gen_hex_token(), _gen_staff_code(),
  _event_by(text, text), _org_by_admin_key(text), _org_event(text, uuid),
  _session_json(events), _session_admin_json(events),
  _get_player_locked(uuid, text), _new_player_code(uuid, text), _make_team(uuid, text, text),
  _create_event_for_player(players, integer, integer),
  _award_stats(uuid), _team_stats(uuid),
  _pick_award(uuid, text, text, boolean, uuid[]), _pick_team_award(uuid, text, text, boolean, uuid[]),
  _event_awards(uuid),
  _event_players_detail(uuid), _event_teams_detail(uuid), _event_station_metrics(uuid), _event_activity(uuid, integer)
  from public, anon, authenticated;
