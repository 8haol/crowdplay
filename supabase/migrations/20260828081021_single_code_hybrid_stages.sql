-- Life Passport V3.1 — one code per player, hybrid life-event gates, and an
-- individual-first awards ceremony.
--
-- 1. THE TEAM CODE IS GONE FROM THE PRODUCT.
--    Two codes on site meant staff asking "队伍码多少？" and players not knowing.
--    A team is now identified by any member's personal code, which
--    `staff_lookup_team` already resolved. `teams.code` stays in the database as
--    an internal label for audit rows and logs, but no player, station, admin or
--    projector surface shows it any more.
--
-- 2. PLAYER CODES ARE THREE DIGITS, 100–999.
--    Shorter to read out across a noisy hall, and no leading zero means nobody
--    has to wonder whether the 0 counts. 900 codes for ~50 players is a 5% load,
--    which the existing retry loop absorbs. Archived 4-digit codes keep working.
--
-- 3. LIFE-EVENT STAGES NOW TRIGGER ON SCORE **OR** STATION COUNT.
--    A pure score gate cannot guarantee three events: a team that scores 3s all
--    the way finishes seven stations on 21 points and never passes 35 or 45, and
--    a x1.5 / halve outcome can vault a player over a gate that then counts as
--    already walked. A pure station gate guarantees three but loses the "I just
--    hit 35, something is about to happen" feeling. Whichever comes first now
--    fires the stage — points for the fast, stations for everyone else, so the
--    count is always exactly three and the last one still lands after station 7.

-- ---------------------------------------------------------------------------
-- Three-digit passport codes
-- ---------------------------------------------------------------------------
-- char(4) blank-pads, which would silently store '123 ' for a 3-digit code and
-- break equality against a text parameter. Move to text with a length check.
-- The legacy `leaderboard` view (owner-only since the security hardening
-- migration) pins the column type, so drop and recreate it around the change.
drop view if exists leaderboard;
alter table players alter column code type text;
create view leaderboard as
  select name, code, identity, score
  from players
  where not is_removed
  order by score desc, created_at asc;
revoke all on leaderboard from anon, authenticated;
alter table players drop constraint if exists players_code_length;
alter table players add constraint players_code_length
  check (length(code) between 3 and 4);

comment on column players.code is
  'Passport credential. New codes are 3 digits (100-999); 4-digit codes from '
  'archived sessions remain valid for recovery.';

/* Allocate an unused passport code. Kept in one place so every join path
   (QR link, legacy passphrase) issues the same shape. */
create or replace function _new_player_code(p_name text)
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
  for i in 1..200 loop
    -- 100-999: three digits, never a leading zero
    v_code := (100 + floor(random() * 900))::int::text;
    begin
      insert into players (name, code) values (p_name, v_code) returning players.id into v_id;
      player_id := v_id;
      code := v_code;
      return next;
      return;
    exception when unique_violation then
      v_id := null;
    end;
  end loop;
  raise exception 'CODE_POOL_EXHAUSTED';
end;
$$;

create or replace function join_by_link(p_name text, p_join_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state game_state;
  v_name text := trim(coalesce(p_name, ''));
  v_new record;
  v_team uuid;
  v_color text;
begin
  select * into v_state from game_state where id = 1 for update;
  if p_join_token is distinct from v_state.join_token then
    if exists (select 1 from game_archives where join_token = p_join_token) then raise exception 'GAME_ARCHIVED'; end if;
    raise exception 'BAD_GAME_LINK';
  end if;
  if not v_state.join_open then raise exception 'JOIN_CLOSED'; end if;
  if v_state.phase = 'ended' then raise exception 'GAME_ARCHIVED'; end if;
  if length(v_name) < 1 or length(v_name) > 20 then raise exception 'BAD_NAME'; end if;

  select * into v_new from _new_player_code(v_name);

  if v_state.phase = 'playing' then
    v_color := 'solo-' || (((select count(*) from teams where identity = 'solo') % 8) + 1)::text;
    v_team := _make_team('solo', v_color);
    update players set identity = 'solo', color_group = v_color, team_id = v_team
    where id = v_new.player_id;
  end if;
  return jsonb_build_object('player_id', v_new.player_id, 'code', v_new.code,
                            'event_id', v_state.event_id, 'title', v_state.title);
end;
$$;

create or replace function join_game(p_name text, p_passphrase text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state game_state;
  v_name text := trim(coalesce(p_name, ''));
  v_new record;
  v_team uuid;
  v_color text;
begin
  select * into v_state from game_state where id = 1 for update;
  if v_state.phase = 'ended' then raise exception 'GAME_ENDED'; end if;
  if not _secret_matches(v_state.join_passphrase, trim(coalesce(p_passphrase, ''))) then
    perform _throttle_failed_attempt('join-passphrase');
    raise exception 'BAD_PASSPHRASE';
  end if;
  if length(v_name) < 1 or length(v_name) > 20 then raise exception 'BAD_NAME'; end if;

  select * into v_new from _new_player_code(v_name);

  if v_state.phase = 'playing' then
    v_color := 'solo-' || (((select count(*) from teams where identity = 'solo') % 8) + 1)::text;
    v_team := _make_team('solo', v_color);
    update players set identity = 'solo', color_group = v_color, team_id = v_team
    where id = v_new.player_id;
  end if;
  return jsonb_build_object('player_id', v_new.player_id, 'code', v_new.code);
end;
$$;

-- ---------------------------------------------------------------------------
-- Hybrid stage gates: score OR stations, whichever arrives first
-- ---------------------------------------------------------------------------

/* Personal score that opens stage N on its own. */
create or replace function _stage_score_gate(p_stage int)
returns int
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_stage when 1 then 15 when 2 then 35 when 3 then 45 end;
$$;

create or replace function _due_stage(p_player_id uuid)
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
      or _main_stations_done(p_player_id) >= _stage_unlock_at(s)
    );
$$;

-- ---------------------------------------------------------------------------
-- Player payload: no team code, teammates by name, both next-stage gates
-- ---------------------------------------------------------------------------
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
    'stations_done', _main_stations_done(p.id),
    'stations_total', _main_station_total(),
    'life_events_done', (select count(*)::int from life_event_instances i
                         where i.player_id = p.id and i.state = 'resolved'),
    'life_events_total', 3,
    'pending_stage', p.pending_stage,
    'next_event_stage', _next_stage(p.id),
    'next_event_after_station', (select _stage_unlock_at(_next_stage(p.id))),
    'next_event_score', (select _stage_score_gate(_next_stage(p.id)))
  );
$$;

create or replace function _team_json(p_team_id uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'team_id', t.id,
    'identity', t.identity,
    'color_group', t.color_group,
    'challenge_score', t.challenge_score,
    'members', coalesce((select jsonb_agg(jsonb_build_object(
      'name', p.name, 'score', p.score, 'token_available', p.token_available
    ) order by p.created_at) from players p where p.team_id = t.id and not p.is_removed), '[]'::jsonb)
  )
  from teams t where t.id = p_team_id;
$$;

-- ---------------------------------------------------------------------------
-- Awards: individual prizes for individual metrics, team prizes for team ones
-- ---------------------------------------------------------------------------
--
-- The previous ceremony handed a "best company" prize to the team with the
-- highest combined score, which a Solo player can never win — the whole point
-- of the podium is that it is personal. Awards are now split by what actually
-- decides them:
--
--   * A player's own score, and their life-event swings, differ inside a team.
--     Those stay individual.
--   * Station scores, perfect runs and finishing time are recorded once per
--     team, so every member has identical numbers. Awarding one arbitrary
--     member would be a coin flip, so those are team awards, announced with
--     everybody's name.

/* Per-team metrics for the team awards. */
create or replace function _team_stats()
returns table (
  team_id uuid,
  identity text,
  color_group text,
  members text,
  member_count int,
  created_at timestamptz,
  stations_done int,
  station_score int,
  nines int,
  last_at timestamptz
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
         coalesce(a.done, 0)::int,
         coalesce(a.total, 0)::int,
         coalesce(a.nines, 0)::int,
         a.last_at
  from teams t
  left join (
    select ta.team_id,
           count(*) done,
           sum(ta.score) total,
           count(*) filter (where ta.score >= 9) nines,
           max(ta.created_at) last_at
    from team_attempts ta join stations s on s.id = ta.station_id
    where s.type = 'main' and ta.status in ('passed', 'failed')
    group by ta.team_id
  ) a on a.team_id = t.id
  where exists (select 1 from players p where p.team_id = t.id and not p.is_removed);
$$;

create or replace function _pick_team_award(
  p_qualify text,
  p_metric text,
  p_desc boolean,
  p_exclude uuid[]
)
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
    'select team_id from _team_stats() where %s and not (team_id = any($1))
     order by %s %s, created_at asc, team_id::text limit 1', p_qualify, p_metric, v_dir)
  into v_id using coalesce(p_exclude, '{}'::uuid[]);
  if v_id is null then
    execute format(
      'select team_id from _team_stats() where %s order by %s %s, created_at asc, team_id::text limit 1',
      p_qualify, p_metric, v_dir) into v_id;
  end if;
  return v_id;
end;
$$;

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
  v_used_teams uuid[] := '{}';
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

  -- Individual specials. Every metric here genuinely differs between teammates.
  for v_row in
    select * from (values
      ('ev_net > 0',   'ev_net',        true,  'lucky',
        '🍀', '天选之子',   '人生事件加分最多',        '人生事件净赚 +%s 分'),
      ('ev_net < 0',   'ev_net',        false, 'unlucky',
        '🌧️', '时运不济',   '人生事件扣分最多',        '人生事件净亏 %s 分'),
      ('ev_swing > 0', 'ev_swing',      true,  'rollercoaster',
        '🎢', '人生过山车', '单次人生事件波动最大',    '一次事件波动 %s 分'),
      ('ev_count >= 2', 'abs(ev_net)',  false, 'steady_heart',
        '🌊', '波澜不惊',   '经历过人生，却最稳得住',  '三段人生净变化只有 %s 分')
    ) as t(qualify, metric, is_desc, key, emoji, title, subtitle, caption)
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
      'caption', format(v_row.caption, case v_row.key
        when 'lucky' then v_stat.ev_net::text
        when 'unlucky' then abs(v_stat.ev_net)::text
        when 'rollercoaster' then v_stat.ev_swing::text
        else abs(v_stat.ev_net)::text end)
    );
  end loop;

  -- Team awards: the station run is scored once per team, so these belong to
  -- everybody who walked it together.
  for v_row in
    select * from (values
      ('last_at is not null and stations_done >= ' || v_total, 'last_at', false, 'fastest',
        '⚡', '最快通关',     '全场最先走完所有站点',    '全场第一个完成 %s 站'),
      ('station_score > 0', 'station_score', true, 'challenger',
        '🎯', '挑战王',       '七站挑战本身拿分最高',    '站点挑战共拿下 %s 分'),
      ('nines > 0', 'nines', true, 'perfectionist',
        '⭐', '满分收藏家',   '拿下满分的挑战最多',      '%s 站拿到满分 9 分')
    ) as t(qualify, metric, is_desc, key, emoji, title, subtitle, caption)
  loop
    v_id := _pick_team_award(v_row.qualify, v_row.metric, v_row.is_desc, v_used_teams);
    if v_id is null then continue; end if;
    select * into v_team from _team_stats() where team_id = v_id;
    v_used_teams := v_used_teams || v_id;
    v_team_awards := v_team_awards || jsonb_build_object(
      'key', v_row.key, 'emoji', v_row.emoji, 'title', v_row.title,
      'subtitle', v_row.subtitle,
      'members', v_team.members, 'member_count', v_team.member_count,
      'identity', v_team.identity, 'color_group', v_team.color_group,
      'caption', format(v_row.caption, case v_row.key
        when 'fastest' then v_team.stations_done::text
        when 'challenger' then v_team.station_score::text
        else v_team.nines::text end)
    );
  end loop;

  return jsonb_build_object(
    'podium', v_podium,
    'specials', v_specials,
    'team_awards', v_team_awards
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Projector snapshot: teammates grouped by colour, no codes of any kind
-- ---------------------------------------------------------------------------
create or replace function board_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_state game_state;
begin
  select * into v_state from game_state where id = 1;
  return jsonb_build_object(
    'phase', v_state.phase, 'started_at', v_state.started_at,
    'stations_total', _main_station_total(),
    -- Grouped by team formation order, so teammates are always adjacent, and
    -- never ranked by score while the game is running.
    'players', coalesce((select jsonb_agg(row_json order by sort_team, sort_created, sort_id) from (
      select coalesce(t.created_at, 'infinity'::timestamptz) sort_team,
             p.created_at sort_created, p.id::text sort_id,
             jsonb_build_object(
        'id', p.id, 'team_id', p.team_id,
        'name', p.name,
        'member_count', (select count(*) from players m where m.team_id = p.team_id and not m.is_removed),
        'identity', p.identity, 'color_group', p.color_group, 'score', p.score,
        'locked', p.locked_for_life_event, 'token_available', p.token_available,
        'sick', (p.status_effect ->> 'type') = 'cap_next',
        'stations_done', _main_stations_done(p.id),
        'life_events_done', (select count(*) from life_event_instances i
                             where i.player_id = p.id and i.state = 'resolved')
      ) row_json
      from players p left join teams t on t.id = p.team_id
      where not p.is_removed
    ) personal_board), '[]'::jsonb),
    'stats', jsonb_build_object(
      'players', (select count(*) from players where not is_removed),
      'teams', (select count(*) from teams),
      'stamps', (select count(*) from team_attempts where status in ('passed','failed'))
        + (select count(*) from attempts a join players p on p.id = a.player_id
           where p.team_id is null and not p.is_removed and a.status in ('passed','failed')),
      'life_events', (select count(*) from life_events),
      'tokens_used', (select count(*) from token_usages),
      'top_score', coalesce((select max(score) from players where not is_removed), 0)
    ),
    'awards', case when v_state.phase = 'ended' then _event_awards() end,
    'feed', coalesce((select jsonb_agg(item order by created_at desc) from (
      select created_at, item from (
        select e.created_at, jsonb_build_object(
          'id', 'e' || e.id, 'kind', 'life_event', 'name', p.name,
          'card', e.card_type,
          'label', e.card_label,
          'scene', e.scene_title, 'choice', e.choice_label, 'outcome', e.card_label,
          'stage', e.stage,
          'before', e.score_before, 'after', e.score_after, 'at', e.created_at
        ) item from life_events e join players p on p.id = e.player_id where not p.is_removed
        union all
        select a.created_at, jsonb_build_object(
          'id', 'ta' || a.id, 'kind', 'attempt',
          'name', coalesce((select string_agg(p.name, ' / ' order by p.created_at)
                            from players p where p.team_id = t.id and not p.is_removed), '—'),
          'color_group', t.color_group, 'identity', t.identity,
          'station', s.name_zh, 'status', a.status, 'score', a.score, 'at', a.created_at
        ) from team_attempts a join teams t on t.id = a.team_id join stations s on s.id = a.station_id
          where a.status in ('passed','failed')
        union all
        select a.created_at, jsonb_build_object(
          'id', 'a' || a.id, 'kind', 'attempt', 'name', p.name,
          'station', s.name_zh, 'status', a.status, 'score', a.score, 'at', a.created_at
        ) from attempts a join players p on p.id = a.player_id join stations s on s.id = a.station_id
          where p.team_id is null and not p.is_removed and a.status in ('passed','failed')
        union all
        select u.created_at, jsonb_build_object(
          'id', 'u' || u.id, 'kind', 'token', 'name', p.name,
          'usage', u.usage_type, 'station', s.name_zh, 'at', u.created_at
        ) from token_usages u join players p on p.id = u.player_id
          left join stations s on s.id = u.target_station_id where not p.is_removed
      ) feed_union order by created_at desc limit 60
    ) recent), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: teams identified by colour + members, never by a short code
-- ---------------------------------------------------------------------------
create or replace function _current_teams_detail()
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
  ), '[]'::jsonb) from teams t;
$$;

create or replace function _current_activity(p_limit int default 40)
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
      where a.status in ('passed','failed')
      union all
      select e.created_at, jsonb_build_object(
        'id', 'event-' || e.id, 'kind', 'life_event', 'at', e.created_at,
        'player_name', p.name, 'player_code', p.code,
        'label', coalesce(e.scene_title, '人生事件'), 'detail', e.card_label
      ) from life_events e join players p on p.id = e.player_id where not p.is_removed
      union all
      select u.created_at, jsonb_build_object(
        'id', 'token-' || u.id, 'kind', 'token', 'at', u.created_at,
        'player_name', p.name, 'player_code', p.code,
        'label', 'Help Token', 'detail', u.usage_type
      ) from token_usages u join players p on p.id = u.player_id where not p.is_removed
      union all
      select aa.created_at, jsonb_build_object(
        'id', 'admin-' || aa.id, 'kind', 'admin', 'at', aa.created_at,
        'player_name', p.name, 'player_code', p.code,
        'label', '管理员操作', 'detail', coalesce(aa.reason, aa.action)
      ) from admin_actions aa left join players p on p.id = aa.player_id
    ) activity_union order by occurred_at desc
    limit greatest(1, least(coalesce(p_limit, 40), 200))
  ) recent;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function
  _new_player_code(text), _stage_score_gate(int), _team_stats(),
  _pick_team_award(text, text, boolean, uuid[])
  from public, anon, authenticated;

grant execute on function
  board_snapshot(),
  join_by_link(text, text),
  join_game(text, text)
to anon, authenticated;
