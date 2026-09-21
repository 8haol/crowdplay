-- 每场活动一个主题。passport = 今天的人生护照；midautumn = 中秋游园会。
alter table events add column theme text not null default 'passport'
  check (theme in ('passport', 'midautumn'));
comment on column events.theme is '玩家/大屏/义工页的皮肤与文案字典；后台不换皮。';

create or replace function _check_theme(p_theme text) returns text
language sql immutable as $$
  select case when p_theme in ('passport', 'midautumn') then p_theme end
$$;

revoke execute on function _check_theme(text) from public, anon, authenticated;

-- _session_admin_json 基于 _session_json 拼接，自动带上 theme。
-- 源：20260912000200_tenant_resolve.sql
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
    'theme', e.theme,
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

-- 源：20260913000300_event_station_reads.sql
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
    'theme', v_event.theme,
    'phase', v_event.phase,
    'org', (select jsonb_build_object('slug', o.slug, 'name_zh', o.name_zh, 'name_en', o.name_en)
            from organizations o where o.id = v_event.org_id),
    'stations', staff_stations(p_staff_key)
  );
end;
$$;

-- 源：20260913000300_event_station_reads.sql
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

-- 源：20260916000200_hold_ranks_until_published.sql
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
    -- 本场启用的站点，形状与 staff_stations 一致。护照的格子照这个画。
    'stations', coalesce((select jsonb_agg(jsonb_build_object(
      'id', es.station_id, 'station_id', es.station_id, 'name_zh', es.name_zh,
      'type', es.type, 'scoring_mode', es.scoring_mode, 'sort_order', es.sort_order
      ) order by es.sort_order)
      from event_stations es
      where es.event_id = v_event.id and es.disabled_at is null), '[]'::jsonb)
  ) || jsonb_build_object('theme', v_event.theme);
end;
$$;

-- 源：20260913000200_event_station_rpcs.sql
drop function if exists admin_create_event(text, text);
create or replace function admin_create_event(p_admin_key text, p_title text, p_theme text default 'passport')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org organizations;
  v_title text := trim(coalesce(p_title, ''));
  v_theme text := _check_theme(coalesce(p_theme, 'passport'));
  v_new events;
  i int;
begin
  v_org := _org_by_admin_key(p_admin_key);
  if length(v_title) < 1 or length(v_title) > 60 then raise exception 'BAD_GAME_TITLE'; end if;
  if v_theme is null then raise exception 'BAD_THEME'; end if;
  if exists (select 1 from events where org_id = v_org.id and phase = 'playing') then
    raise exception 'ACTIVE_EVENT_EXISTS';
  end if;
  for i in 1..10 loop
    begin
      insert into events (org_id, title, theme, join_token, staff_code, screen_token)
      values (v_org.id, v_title, v_theme, _gen_hex_token(), _gen_staff_code(), _gen_hex_token())
      returning * into v_new;
      perform _seed_event_stations(v_org.id, v_new.id);
      return _session_admin_json(v_new);
    exception when unique_violation then
      null; -- 6 位码撞了，重新生成
    end;
  end loop;
  raise exception 'TOKEN_GENERATION_FAILED';
end;
$$;

-- 源：20260912000500_tenant_admin_rpcs.sql
drop function if exists admin_update_game(text, uuid, text, boolean);
create or replace function admin_update_game(p_admin_key text, p_event_id uuid, p_title text default null, p_join_open boolean default null, p_theme text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events;
  v_title text := trim(coalesce(p_title, ''));
begin
  v_event := _org_event(p_admin_key, p_event_id);
  if p_title is not null and (length(v_title) < 1 or length(v_title) > 60) then raise exception 'BAD_GAME_TITLE'; end if;
  if p_theme is not null and _check_theme(p_theme) is null then raise exception 'BAD_THEME'; end if;
  update events set
    title = case when p_title is null then title else v_title end,
    join_open = coalesce(p_join_open, join_open),
    theme = coalesce(p_theme, theme)
  where id = v_event.id returning * into v_event;
  return _session_admin_json(v_event);
end;
$$;

-- 内部函数保留受限权限；对外 RPC 沿用 anon / authenticated 的授权。
revoke execute on function _session_json(events) from public, anon, authenticated;
grant execute on function
  staff_session(text), board_snapshot(text), poll_player_by_link(text, text),
  admin_create_event(text, text, text), admin_update_game(text, uuid, text, boolean, text)
  to anon, authenticated;
