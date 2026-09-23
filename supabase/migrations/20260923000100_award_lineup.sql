-- 颁奖精简成 7 个：前三名 + 最快通关 + 3 个个人奖（2026-09-23 与用户定稿）。
--
--   领奖台 3 席：先按个人总分取前三。三人来自三个不同的队 → 个人领奖台；
--     有两人以上同队 → 这场改成队伍领奖台：每队一席，按未移除队员的平均分取前三，
--     平分按建队先后；全场队伍不到 3 个时凑不满三席，照个人发。站点分同队共享，
--     个人前三被一队包揽时，本质上就是队伍名次。
--     返回里 podium_mode = 'player' | 'team'，每个 podium 条目带 kind。
--   最快通关 1 个队：7 个主摊位（不含隐藏、已撤）都有有效成绩的队里，按「第一次凑齐
--     全部主摊位」的时间排——每站取最早一次记分（含被再挑战 superseded 的那条），
--     再取最晚的那站；用了再挑战不会把完成时间往后推。跳过领奖台上的队（个人领奖台
--     时是台上那几人所在的队）。caption 写开局到完成的分钟数，不写名次。
--   个人奖最多 3 个，只发新面孔（不在领奖台、不是最快通关队成员、没拿过个人奖）：
--     独行明星先发（独行玩家里总分最高的新面孔），再按 lucky → unlucky → comeback →
--     steady 补满 3 个，找不到新面孔就顺延，候选用尽就少发。
--   满月收集、恩典见证、不偏不倚退出。
--
-- 同时修月下逆袭：min_after 只看扣分那几次际遇之后的分数，并且要求最终分高于谷底。

-- 源：20260921000500_secret_station.sql（只改 min_after）
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
           min(le.score_after) filter (where le.score_after < le.score_before) min_after
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

-- 源：20260921000300_award_pool.sql
create or replace function _event_awards(p_event_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_podium jsonb := '[]'::jsonb;
  v_podium_mode text := 'player';
  v_specials jsonb := '[]'::jsonb;
  v_team_awards jsonb := '[]'::jsonb;
  v_used uuid[] := '{}';
  v_podium_teams uuid[] := '{}';
  v_row record;
  v_id uuid;
  v_stat record;
  v_team record;
  v_rank int := 0;
  v_total int := _main_station_total(p_event_id);
  v_started timestamptz := (select started_at from events where id = p_event_id);
  v_finished timestamptz;
begin
  -- 领奖台：个人前三里有两人以上同队，就整场改成队伍领奖台（队伍不到 3 个时照个人发）。
  if (select count(*) from _team_stats(p_event_id)) >= 3 and exists (
    select 1 from (
      select team_id from _award_stats(p_event_id) order by score desc, joined_at asc, player_id::text limit 3
    ) top where team_id is not null group by team_id having count(*) >= 2
  ) then
    v_podium_mode := 'team';
    for v_row in
      select ts.*, (select round(avg(p.score)::numeric, 1) from players p
                    where p.team_id = ts.team_id and not p.is_removed) avg_score
      from _team_stats(p_event_id) ts
      order by avg_score desc, ts.created_at asc, ts.team_id::text limit 3
    loop
      v_rank := v_rank + 1;
      v_podium := v_podium || jsonb_build_object(
        'rank', v_rank, 'kind', 'team', 'name', v_row.members, 'members', v_row.members,
        'member_count', v_row.member_count, 'score', v_row.avg_score,
        'color_group', v_row.color_group, 'identity', v_row.identity,
        'stations_done', v_row.stations_done, 'life_events', null
      );
      v_podium_teams := v_podium_teams || v_row.team_id;
      v_used := v_used || coalesce((select array_agg(p.id) from players p
                                    where p.team_id = v_row.team_id and not p.is_removed), '{}'::uuid[]);
    end loop;
  else
    for v_row in
      select * from _award_stats(p_event_id) order by score desc, joined_at asc, player_id::text limit 3
    loop
      v_rank := v_rank + 1;
      v_podium := v_podium || jsonb_build_object(
        'rank', v_rank, 'kind', 'player', 'name', v_row.name, 'score', v_row.score,
        'color_group', v_row.color_group, 'identity', v_row.identity,
        'stations_done', v_row.st_done, 'life_events', v_row.ev_count
      );
      if v_row.team_id is not null then v_podium_teams := v_podium_teams || v_row.team_id; end if;
      v_used := v_used || v_row.player_id;
    end loop;
  end if;

  -- 最快通关：第一次凑齐全部主摊位的时间，跳过领奖台上的队。
  select ts.team_id, f.finished_at into v_id, v_finished
  from _team_stats(p_event_id) ts
  join (
    select firsts.team_id, max(firsts.first_at) finished_at
    from (
      select ta.team_id, ta.station_id, min(ta.created_at) first_at
      from team_attempts ta
      join event_stations s on s.event_id = ta.event_id and s.station_id = ta.station_id
      where ta.event_id = p_event_id and s.type = 'main' and not s.hidden and s.disabled_at is null
        and ta.status in ('passed', 'failed', 'superseded')
      group by ta.team_id, ta.station_id
    ) firsts
    group by firsts.team_id
  ) f on f.team_id = ts.team_id
  where ts.stations_done >= v_total and not (ts.team_id = any(v_podium_teams))
  order by f.finished_at asc, ts.created_at asc, ts.team_id::text
  limit 1;
  if v_id is not null then
    select * into v_team from _team_stats(p_event_id) where team_id = v_id;
    v_team_awards := v_team_awards || jsonb_build_object(
      'key', 'fastest', 'emoji', '⚡', 'title', '最快通关', 'subtitle', '飞快走完所有站点',
      'members', v_team.members, 'member_count', v_team.member_count,
      'identity', v_team.identity, 'color_group', v_team.color_group,
      'caption', case when v_started is not null and v_finished > v_started
        then format('开局 %s 分钟走完 %s 站', ceil(extract(epoch from v_finished - v_started) / 60)::int, v_total)
        else format('走完全部 %s 站', v_total) end
    );
    v_used := v_used || coalesce((select array_agg(p.id) from players p where p.team_id = v_id and not p.is_removed), '{}'::uuid[]);
  end if;

  -- 个人奖：独行明星先发，再从池里按序补满 3 个新面孔。
  for v_row in
    select * from (values
      (1, 'is_solo',                                'score desc',             'solo_star', '⭐', '独行明星', '独自出发里总分最高'),
      (2, 'ev_net > 0',                             'ev_net desc',            'lucky',     '🍀', '天选之子', '际遇加分最多'),
      (3, 'ev_net < 0',                             'ev_net asc',             'unlucky',   '🌧️', '时运不济', '际遇扣分最多'),
      (4, 'min_after is not null and score > min_after', '(score - min_after) desc', 'comeback', '🌙', '月下逆袭', '从谷底回升最多'),
      (5, 'ev_count >= 2 and ev_down >= 0',         'ev_count desc, score desc', 'steady', '🪨', '稳如磐石', '际遇里一分没丢')
    ) as t(ord, qualify, ord_by, key, emoji, title, subtitle) order by ord
  loop
    exit when jsonb_array_length(v_specials) >= 3;
    v_id := _pick_award(p_event_id, v_row.qualify, v_row.ord_by, v_used);
    if v_id is null then continue; end if;
    select * into v_stat from _award_stats(p_event_id) where player_id = v_id;
    v_used := v_used || v_id;
    v_specials := v_specials || jsonb_build_object(
      'key', v_row.key, 'emoji', v_row.emoji, 'title', v_row.title, 'subtitle', v_row.subtitle,
      'name', v_stat.name, 'color_group', v_stat.color_group, 'identity', v_stat.identity,
      'score', v_stat.score,
      'caption', case v_row.key
        when 'solo_star' then format('独自出发，%s 分', v_stat.score)
        when 'lucky' then format('际遇净赚 +%s 分', v_stat.ev_net)
        when 'unlucky' then format('际遇净亏 %s 分', abs(v_stat.ev_net))
        when 'comeback' then format('最低时只剩 %s 分，最后 %s 分', v_stat.min_after, v_stat.score)
        else format('%s 次际遇，一分没丢', v_stat.ev_count)
      end
    );
  end loop;

  return jsonb_build_object('podium', v_podium, 'podium_mode', v_podium_mode,
                            'specials', v_specials, 'team_awards', v_team_awards);
end;
$$;

revoke execute on function _award_stats(uuid), _event_awards(uuid) from public, anon, authenticated;
