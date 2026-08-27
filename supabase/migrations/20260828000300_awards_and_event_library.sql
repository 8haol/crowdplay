-- Life Passport V3.2 — award set that measures three different things, and a
-- reviewable life-event library.
--
-- 1. ONE TEAM AWARD, NOT THREE.
--    「挑战王」(highest station score) and 「满分收藏家」(most 9s) are the same
--    measurement wearing two hats: a team only collects 9s by scoring high, so
--    the same team wins both, and the exclusion pass then hands the second
--    trophy to a team that did not actually lead that metric — a fake award.
--    The station run is the only thing a team does together, so it gets exactly
--    one prize: ⚡ 最快通关, the first team to finish all seven stations. Every
--    other award is personal.
--
-- 2. THE ROLLERCOASTER IS A SPREAD, NOT A MAXIMUM.
--    `ev_swing` used to be max(abs(delta)), so a dozen players who caught one
--    +9 tied on 9 and the winner fell out of join order. It is now
--    max(delta) - min(delta) over that player's own events and only qualifies
--    when they actually went both ways (a real up-and-down), which also makes
--    it independent of 天选之子 (net gain) instead of a near-duplicate.
--    「波澜不惊」is the same number read from the other end: smallest spread.
--
-- 3. THE LIFE-EVENT LIBRARY IS REVIEWABLE WITHOUT THE ADMIN PASSWORD.
--    Volunteers proof-read scenes, actions and every hidden outcome before the
--    event. `admin_life_event_catalog` needed the admin key, which is the one
--    credential we do not hand out. The body moved into a shared helper and is
--    also exposed as `life_event_library()`. NOTE: this makes outcome tables
--    readable by anyone with the URL. That is the point — it is a proofreading
--    page — but /library is deliberately not linked from any player screen.

-- ---------------------------------------------------------------------------
-- Personal award metrics
-- ---------------------------------------------------------------------------
-- Return type changes, so the old signature has to go first.
drop function if exists _award_stats();

create or replace function _award_stats()
returns table (
  player_id uuid,
  name text,
  color_group text,
  identity text,
  score int,
  joined_at timestamptz,
  ev_net int,
  ev_up int,
  ev_down int,
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
  select p.id, p.name, p.color_group, p.identity, p.score, p.created_at,
         coalesce(e.net, 0)::int,
         coalesce(e.up, 0)::int,
         coalesce(e.down, 0)::int,
         coalesce(e.up - e.down, 0)::int,
         coalesce(e.n, 0)::int,
         coalesce(s.total, 0)::int, coalesce(s.nines, 0)::int, coalesce(s.done, 0)::int,
         s.last_at
  from players p
  left join (
    select le.player_id,
           sum(le.score_after - le.score_before) net,
           max(le.score_after - le.score_before) up,
           min(le.score_after - le.score_before) down,
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

-- ---------------------------------------------------------------------------
-- Ceremony payload
-- ---------------------------------------------------------------------------
create or replace function _event_awards()
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
  -- Podium: purely personal, from the top of the individual standings down.
  for v_row in
    select * from _award_stats() order by score desc, joined_at asc, player_id::text limit 3
  loop
    v_rank := v_rank + 1;
    v_podium := v_podium || jsonb_build_object(
      'rank', v_rank, 'name', v_row.name, 'score', v_row.score,
      'color_group', v_row.color_group, 'identity', v_row.identity,
      'stations_done', v_row.st_done, 'life_events', v_row.ev_count
    );
    v_used := v_used || v_row.player_id;
  end loop;

  -- Individual specials. Each metric is a different question about the same
  -- three life events: how much did you gain, how much did you lose, how far
  -- did you travel between the two, how little did you move at all.
  for v_row in
    select * from (values
      ('ev_net > 0',                  'ev_net',   true,  'lucky',
        '🍀', '天选之子',   '人生事件加分最多'),
      ('ev_net < 0',                  'ev_net',   false, 'unlucky',
        '🌧️', '时运不济',   '人生事件扣分最多'),
      ('ev_up > 0 and ev_down < 0',   'ev_swing', true,  'rollercoaster',
        '🎢', '人生过山车', '同时经历了最高的加分和最重的扣分'),
      -- Ascending metric, so a second ascending tie-break can ride along in the
      -- same expression: least spread first, then least net movement.
      ('ev_count >= 2', 'ev_swing, abs(ev_net)', false, 'steady_heart',
        '🌊', '波澜不惊',   '经历过人生，却最稳得住')
    ) as t(qualify, metric, is_desc, key, emoji, title, subtitle)
  loop
    v_id := _pick_award(v_row.qualify, v_row.metric, v_row.is_desc, v_used);
    if v_id is null then continue; end if;
    select * into v_stat from _award_stats() where player_id = v_id;
    v_used := v_used || v_id;
    v_specials := v_specials || jsonb_build_object(
      'key', v_row.key, 'emoji', v_row.emoji, 'title', v_row.title,
      'subtitle', v_row.subtitle,
      'name', v_stat.name,
      'color_group', v_stat.color_group, 'identity', v_stat.identity,
      'score', v_stat.score,
      'caption', case v_row.key
        when 'lucky' then format('人生事件净赚 +%s 分', v_stat.ev_net)
        when 'unlucky' then format('人生事件净亏 %s 分', abs(v_stat.ev_net))
        when 'rollercoaster' then format('一次 +%s，一次 %s，落差 %s 分',
                                         v_stat.ev_up, v_stat.ev_down, v_stat.ev_swing)
        else format('三段人生上下不超过 %s 分', v_stat.ev_swing)
      end
    );
  end loop;

  -- The single team award. Stations are scored once per team, and finishing
  -- time is the one team number that is not just "who scored more".
  v_id := _pick_team_award(
    'last_at is not null and stations_done >= ' || v_total, 'last_at', false, '{}'::uuid[]);
  if v_id is not null then
    select * into v_team from _team_stats() where team_id = v_id;
    v_team_awards := jsonb_build_array(jsonb_build_object(
      'key', 'fastest', 'emoji', '⚡', 'title', '最快通关',
      'subtitle', '全场最先走完所有站点',
      'members', v_team.members, 'member_count', v_team.member_count,
      'identity', v_team.identity, 'color_group', v_team.color_group,
      'caption', format('全场第一个完成 %s 站', v_team.stations_done)
    ));
  end if;

  return jsonb_build_object(
    'podium', v_podium,
    'specials', v_specials,
    'team_awards', v_team_awards
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Life-event library
-- ---------------------------------------------------------------------------
create or replace function _life_event_catalog_json()
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'stats', jsonb_build_object(
      'scenes', (select count(*) from life_event_scenes where active),
      'choices', (select coalesce(sum(jsonb_array_length(choices)), 0)
                  from life_event_scenes where active),
      'outcomes', (select count(*) from life_event_scenes s
        cross join lateral jsonb_array_elements(s.choices) choice
        cross join lateral jsonb_array_elements(choice -> 'outcomes') outcome
        where s.active),
      'by_audience', jsonb_build_object(
        'all', (select count(*) from life_event_scenes where active and audience = 'all'),
        'solo', (select count(*) from life_event_scenes where active and audience = 'solo'),
        'duo', (select count(*) from life_event_scenes where active and audience = 'duo'),
        'trio', (select count(*) from life_event_scenes where active and audience = 'trio')
      )
    ),
    'scenes', coalesce((select jsonb_agg(jsonb_build_object(
      'key', key, 'audience', audience, 'title', title, 'prompt', prompt,
      'emoji', emoji, 'choices', choices, 'active', active, 'sort_order', sort_order
    ) order by sort_order, key) from life_event_scenes), '[]'::jsonb)
  );
$$;

create or replace function admin_life_event_catalog(p_admin_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform _require_key('admin', p_admin_key);
  return _life_event_catalog_json();
end;
$$;

-- Password-free proofreading surface for volunteers. Read-only, and the same
-- payload the admin console shows, so the two can never drift apart.
create or replace function life_event_library()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select _life_event_catalog_json();
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function _award_stats(), _life_event_catalog_json()
  from public, anon, authenticated;

grant execute on function life_event_library() to anon, authenticated;
