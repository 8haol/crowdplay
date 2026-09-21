-- 颁奖改成奖池：领奖台照实，最快通关先发，其余奖只给新面孔。
--
-- 规则（spec §3「改法（2026-09-21 与用户定稿）」）：
--   领奖台 3 席：个人总分前三，不加队伍限制，平分按入场先后。
--   队伍奖最多 2 个，一队最多一个：最快通关（事实，不去重）→ 满月收集（满分站最多；
--     排除已拿最快通关的队；全场无满分或只有最快通关队有满分则不发）。
--   个人奖固定最多 3 个，从 6 个候选按序挑新面孔（不在领奖台、不在队伍奖成员、
--     没拿过个人奖）：lucky → unlucky → comeback → solo_star → grace_witness → median。
--     某项找不到新面孔就顺延，候选用尽就少发，不回落到已获奖的人。
--
-- _award_stats 新增四列：team_id、min_after（际遇后最低分）、grace_score（second_chance
-- 之后在目标站 passed 的那一摊分）、is_solo。返回列变了，必须先 drop。
-- _pick_award / _pick_team_award 去掉「不排除再挑一次」的回落分支，排序表达式整段传入。

-- 源：20260913000300_event_station_reads.sql
drop function if exists _award_stats(uuid);
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
    where a.event_id = p_event_id and st2.type = 'main' and st2.disabled_at is null and a.status in ('passed', 'failed')
    group by a.player_id
  ) s on s.player_id = p.id
  where p.event_id = p_event_id and not p.is_removed;
$$;

revoke execute on function _award_stats(uuid) from public, anon, authenticated;

-- 源：20260912000200_tenant_resolve.sql（去掉回落分支；p_order 是整段 order by 表达式）
drop function if exists _pick_award(uuid, text, text, boolean, uuid[]);
create or replace function _pick_award(p_event_id uuid, p_qualify text, p_order text, p_exclude uuid[])
returns uuid
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  execute format(
    'select player_id from _award_stats($2) where %s and not (player_id = any($1))
     order by %s, joined_at asc, player_id::text limit 1', p_qualify, p_order)
  into v_id using coalesce(p_exclude, '{}'::uuid[]), p_event_id;
  return v_id;
end;
$$;

drop function if exists _pick_team_award(uuid, text, text, boolean, uuid[]);
create or replace function _pick_team_award(p_event_id uuid, p_qualify text, p_order text, p_exclude uuid[])
returns uuid
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  execute format(
    'select team_id from _team_stats($2) where %s and not (team_id = any($1))
     order by %s, created_at asc, team_id::text limit 1', p_qualify, p_order)
  into v_id using coalesce(p_exclude, '{}'::uuid[]), p_event_id;
  return v_id;
end;
$$;

revoke execute on function _pick_award(uuid, text, text, uuid[]), _pick_team_award(uuid, text, text, uuid[])
  from public, anon, authenticated;

-- 源：20260913000300_event_station_reads.sql
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
  v_used_teams uuid[] := '{}';
  v_row record;
  v_id uuid;
  v_stat record;
  v_team record;
  v_rank int := 0;
  v_total int := _main_station_total(p_event_id);
  v_count int := (select count(*) from _award_stats(p_event_id));
  v_median_id uuid;
begin
  -- 领奖台：事实，不去重。
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

  -- 队伍奖：最快通关（事实）→ 满月收集（去重）。
  v_id := _pick_team_award(p_event_id,
    'last_at is not null and stations_done >= ' || v_total, 'last_at asc', '{}'::uuid[]);
  if v_id is not null then
    select * into v_team from _team_stats(p_event_id) where team_id = v_id;
    v_team_awards := v_team_awards || jsonb_build_object(
      'key', 'fastest', 'emoji', '⚡', 'title', '最快通关', 'subtitle', '全场最先走完所有站点',
      'members', v_team.members, 'member_count', v_team.member_count,
      'identity', v_team.identity, 'color_group', v_team.color_group,
      'caption', format('全场第一个完成 %s 站', v_team.stations_done)
    );
    v_used_teams := v_used_teams || v_id;
    v_used := v_used || coalesce((select array_agg(p.id) from players p where p.team_id = v_id and not p.is_removed), '{}'::uuid[]);
  end if;

  v_id := _pick_team_award(p_event_id, 'nines > 0', 'nines desc, last_at asc', v_used_teams);
  if v_id is not null then
    select * into v_team from _team_stats(p_event_id) where team_id = v_id;
    v_team_awards := v_team_awards || jsonb_build_object(
      'key', 'full_moon', 'emoji', '🌕', 'title', '满月收集', 'subtitle', '满分站点最多的队',
      'members', v_team.members, 'member_count', v_team.member_count,
      'identity', v_team.identity, 'color_group', v_team.color_group,
      'caption', format('%s 站满分', v_team.nines)
    );
    v_used_teams := v_used_teams || v_id;
    v_used := v_used || coalesce((select array_agg(p.id) from players p where p.team_id = v_id and not p.is_removed), '{}'::uuid[]);
  end if;

  -- 个人奖：池里按序挑最多 3 个新面孔。中位数偶数人取偏低的那个。
  select x.player_id into v_median_id from (
    select s.player_id, row_number() over (order by s.score, s.joined_at, s.player_id::text) rn
    from _award_stats(p_event_id) s
  ) x where x.rn = (v_count + 1) / 2;

  for v_row in
    select * from (values
      (1, 'ev_net > 0',                            'ev_net desc',              'lucky',         '🍀', '天选之子', '际遇加分最多'),
      (2, 'ev_net < 0',                            'ev_net asc',               'unlucky',       '🌧️', '时运不济', '际遇扣分最多'),
      (3, 'ev_down < 0 and min_after is not null', '(score - min_after) desc', 'comeback',      '🌙', '月下逆袭', '从谷底回升最多'),
      (4, 'is_solo',                               'score desc',               'solo_star',     '⭐', '独行明星', '独自出发里总分最高'),
      (5, 'grace_score is not null',               'grace_score desc',         'grace_witness', '🕊️', '恩典见证', '跌倒之后又站起来'),
      (6, 'median',                                'score',                    'median',        '⚖️', '不偏不倚', '全场正中间的那个人')
    ) as t(ord, qualify, ord_by, key, emoji, title, subtitle) order by ord
  loop
    exit when jsonb_array_length(v_specials) >= 3;
    if v_row.key = 'median' then
      v_id := case when v_median_id is not null and not (v_median_id = any(v_used)) then v_median_id end;
    else
      v_id := _pick_award(p_event_id, v_row.qualify, v_row.ord_by, v_used);
    end if;
    if v_id is null then continue; end if;
    select * into v_stat from _award_stats(p_event_id) where player_id = v_id;
    v_used := v_used || v_id;
    v_specials := v_specials || jsonb_build_object(
      'key', v_row.key, 'emoji', v_row.emoji, 'title', v_row.title, 'subtitle', v_row.subtitle,
      'name', v_stat.name, 'color_group', v_stat.color_group, 'identity', v_stat.identity,
      'score', v_stat.score,
      'caption', case v_row.key
        when 'lucky' then format('际遇净赚 +%s 分', v_stat.ev_net)
        when 'unlucky' then format('际遇净亏 %s 分', abs(v_stat.ev_net))
        when 'comeback' then format('最低时只剩 %s 分，最后 %s 分', v_stat.min_after, v_stat.score)
        when 'solo_star' then format('一个人走完，%s 分', v_stat.score)
        when 'grace_witness' then format('再挑战那一站拿了 %s 分', v_stat.grace_score)
        else format('全场 %s 人，正中间是 %s 分', v_count, v_stat.score)
      end
    );
  end loop;

  return jsonb_build_object('podium', v_podium, 'specials', v_specials, 'team_awards', v_team_awards);
end;
$$;

revoke execute on function _event_awards(uuid) from public, anon, authenticated;
