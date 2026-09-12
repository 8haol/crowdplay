-- Life Passport · 多租户阶段 1 · 管理端 RPC 与权限
-- 管理密码决定机构；凡是操作某一场的调用都多收一个 p_event_id，并由 _org_event 断言归属。
-- 旧签名一律先 drop：参数列表变了，不 drop 会留下同名重载。

drop function if exists admin_dashboard(text);
drop function if exists admin_console(text);
drop function if exists admin_event_detail(text, uuid);
drop function if exists admin_create_game(text, text, boolean);
drop function if exists admin_update_game(text, text, boolean);
drop function if exists start_game(text, jsonb);
drop function if exists end_game(text);
drop function if exists admin_update_station(text, integer, text, text);
drop function if exists admin_list_players(text);
drop function if exists admin_remove_player(text, text);
drop function if exists admin_adjust(text, text, integer, boolean, boolean, boolean, boolean, integer, text);
drop function if exists admin_update_access(text, text, text);
drop function if exists admin_life_event_catalog(text);

-- 一场活动在列表里的样子：钥匙 + 几个数字。
create or replace function _event_summary_json(e events)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select _session_admin_json(e) || jsonb_build_object(
    'stamps', (select count(*) from team_attempts a where a.event_id = e.id and a.status in ('passed','failed')),
    'life_events', (select count(*) from life_events x where x.event_id = e.id),
    'tokens_used', (select count(*) from token_usages u where u.event_id = e.id),
    'top_score', coalesce((select max(p.score) from players p where p.event_id = e.id and not p.is_removed), 0)
  );
$$;

-- ---------------------------------------------------------------------------
-- 机构总览：全部场次 + 当前进行中的那一场
-- ---------------------------------------------------------------------------
create or replace function admin_dashboard(p_admin_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org organizations;
begin
  v_org := _org_by_admin_key(p_admin_key);
  return jsonb_build_object(
    'org', jsonb_build_object('id', v_org.id, 'slug', v_org.slug, 'name_zh', v_org.name_zh, 'name_en', v_org.name_en),
    'events', coalesce((select jsonb_agg(_event_summary_json(e) order by e.created_at desc)
                        from events e where e.org_id = v_org.id), '[]'::jsonb),
    'live_event_id', (select e.id from events e where e.org_id = v_org.id and e.phase = 'playing'
                      order by e.started_at desc limit 1)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 场次工作台
-- ---------------------------------------------------------------------------
create or replace function admin_console(p_admin_key text, p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events;
  v_org organizations;
  v_top int;
begin
  v_event := _org_event(p_admin_key, p_event_id);
  select * into v_org from organizations where id = v_event.org_id;
  select coalesce(max(score), 0) into v_top from players where event_id = v_event.id and not is_removed;
  return jsonb_build_object(
    'org', jsonb_build_object('id', v_org.id, 'slug', v_org.slug, 'name_zh', v_org.name_zh, 'name_en', v_org.name_en),
    'current', _session_admin_json(v_event),
    'stats', jsonb_build_object(
      'players', (select count(*) from players where event_id = v_event.id and not is_removed),
      'teams', (select count(*) from teams where event_id = v_event.id),
      'stamps', (select count(*) from team_attempts where event_id = v_event.id and status in ('passed','failed')),
      'life_events', (select count(*) from life_events where event_id = v_event.id),
      'tokens_used', (select count(*) from token_usages where event_id = v_event.id),
      'top_score', v_top,
      'top_personal_score', v_top,
      'locked_players', (select count(*) from players where event_id = v_event.id and not is_removed and locked_for_life_event),
      'removed_players', (select count(*) from players where event_id = v_event.id and is_removed)
    ),
    'teams', _event_teams_detail(v_event.id),
    'station_metrics', _event_station_metrics(v_event.id),
    'activity', _event_activity(v_event.id, 50),
    'events', coalesce((select jsonb_agg(_event_summary_json(e) order by e.created_at desc)
                        from events e where e.org_id = v_org.id), '[]'::jsonb)
  );
end;
$$;

create or replace function admin_event_detail(p_admin_key text, p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events;
begin
  v_event := _org_event(p_admin_key, p_event_id);
  return jsonb_build_object(
    'is_current', v_event.phase <> 'ended',
    'session', _session_admin_json(v_event),
    'players', _event_players_detail(v_event.id),
    'teams', _event_teams_detail(v_event.id),
    'station_metrics', _event_station_metrics(v_event.id),
    'activity', _event_activity(v_event.id, 200),
    'admin_log', coalesce((select jsonb_agg(jsonb_build_object(
      'id', aa.id, 'action', aa.action, 'detail', aa.detail, 'reason', aa.reason,
      'player_name', p.name, 'player_code', p.code, 'created_at', aa.created_at
    ) order by aa.created_at desc) from admin_actions aa left join players p on p.id = aa.player_id
      where aa.event_id = v_event.id), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 新建场次：不再清空任何东西，旧场留在原地。
-- ---------------------------------------------------------------------------
create or replace function admin_create_event(p_admin_key text, p_title text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org organizations;
  v_title text := trim(coalesce(p_title, ''));
  v_new events;
  i int;
begin
  v_org := _org_by_admin_key(p_admin_key);
  if length(v_title) < 1 or length(v_title) > 60 then raise exception 'BAD_GAME_TITLE'; end if;
  if exists (select 1 from events where org_id = v_org.id and phase = 'playing') then
    raise exception 'ACTIVE_EVENT_EXISTS';
  end if;
  for i in 1..10 loop
    begin
      insert into events (org_id, title, join_token, staff_code, screen_token)
      values (v_org.id, v_title, _gen_hex_token(), _gen_staff_code(), _gen_hex_token())
      returning * into v_new;
      return _session_admin_json(v_new);
    exception when unique_violation then
      null; -- 6 位码撞了，重新生成
    end;
  end loop;
  raise exception 'TOKEN_GENERATION_FAILED';
end;
$$;

create or replace function admin_update_game(p_admin_key text, p_event_id uuid, p_title text default null, p_join_open boolean default null)
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
  update events set
    title = case when p_title is null then title else v_title end,
    join_open = coalesce(p_join_open, join_open)
  where id = v_event.id returning * into v_event;
  return _session_admin_json(v_event);
end;
$$;

-- ---------------------------------------------------------------------------
-- 开局 / 结束
-- ---------------------------------------------------------------------------
create or replace function start_game(p_admin_key text, p_event_id uuid, p_quota jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events;
  v_trio_q int := greatest(coalesce((p_quota ->> 'trio')::int, 0), 0);
  v_duo_q int := greatest(coalesce((p_quota ->> 'duo')::int, 0), 0);
  v_ids uuid[];
  v_total int;
  v_pos int := 1;
  v_group int := 0;
  v_trio_made int := 0;
  v_duo_made int := 0;
  v_solo_made int := 0;
  v_palette text[] := array[
    'red','orange','yellow','green','teal','cyan','blue','indigo',
    'purple','pink','rose','lime','amber','emerald','sky','violet',
    'fuchsia','coral','gold','navy','olive','maroon','plum','mint'
  ];
  v_color text;
  v_team uuid;
begin
  v_event := _org_event(p_admin_key, p_event_id);
  select * into v_event from events where id = v_event.id for update;
  if v_event.phase <> 'waiting' then raise exception 'ALREADY_STARTED'; end if;
  if exists (select 1 from events where org_id = v_event.org_id and phase = 'playing' and id <> v_event.id) then
    raise exception 'ACTIVE_EVENT_EXISTS';
  end if;

  select coalesce(array_agg(id order by random()), '{}') into v_ids
  from players where event_id = v_event.id and not is_removed;
  v_total := coalesce(array_length(v_ids, 1), 0);
  if v_total = 0 then raise exception 'NO_PLAYERS'; end if;

  while v_trio_made < v_trio_q and v_pos + 2 <= v_total loop
    v_group := v_group + 1;
    v_color := v_palette[(v_group - 1) % array_length(v_palette, 1) + 1]
      || case when v_group > array_length(v_palette, 1)
              then '-' || ((v_group - 1) / array_length(v_palette, 1) + 1)::text else '' end;
    v_team := _make_team(v_event.id, 'trio', v_color);
    update players set identity = 'trio', color_group = v_color, team_id = v_team
    where id = any(v_ids[v_pos:v_pos + 2]);
    v_pos := v_pos + 3; v_trio_made := v_trio_made + 1;
  end loop;

  while v_duo_made < v_duo_q and v_pos + 1 <= v_total loop
    v_group := v_group + 1;
    v_color := v_palette[(v_group - 1) % array_length(v_palette, 1) + 1]
      || case when v_group > array_length(v_palette, 1)
              then '-' || ((v_group - 1) / array_length(v_palette, 1) + 1)::text else '' end;
    v_team := _make_team(v_event.id, 'duo', v_color);
    update players set identity = 'duo', color_group = v_color, team_id = v_team
    where id = any(v_ids[v_pos:v_pos + 1]);
    v_pos := v_pos + 2; v_duo_made := v_duo_made + 1;
  end loop;

  while v_pos <= v_total loop
    v_solo_made := v_solo_made + 1;
    v_color := 'solo-' || (((v_solo_made - 1) % 8) + 1)::text;
    v_team := _make_team(v_event.id, 'solo', v_color);
    update players set identity = 'solo', color_group = v_color, team_id = v_team
    where id = v_ids[v_pos];
    v_pos := v_pos + 1;
  end loop;

  update events set phase = 'playing', started_at = now() where id = v_event.id;
  return jsonb_build_object(
    'total_players', v_total, 'trio_groups', v_trio_made, 'duo_groups', v_duo_made,
    'solo_players', v_solo_made, 'total_teams', v_trio_made + v_duo_made + v_solo_made
  );
end;
$$;

create or replace function end_game(p_admin_key text, p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events;
begin
  v_event := _org_event(p_admin_key, p_event_id);
  update events set phase = 'ended', ended_at = now(), join_open = false where id = v_event.id;
  return jsonb_build_object('phase', 'ended', 'event_id', v_event.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 站点：阶段 1 仍是全局 9 行，所以任何一场在进行中都不能改。阶段 2 改为每场自己的。
-- ---------------------------------------------------------------------------
create or replace function admin_update_station(p_admin_key text, p_station_id integer, p_name_zh text, p_scoring_mode text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_station stations;
  v_name text := trim(coalesce(p_name_zh, ''));
begin
  perform _org_by_admin_key(p_admin_key);
  if exists (select 1 from events where phase = 'playing') then raise exception 'GAME_IN_PROGRESS'; end if;
  if length(v_name) < 1 or length(v_name) > 30 then raise exception 'BAD_STATION_NAME'; end if;
  select * into v_station from stations where id = p_station_id;
  if not found then raise exception 'BAD_STATION'; end if;
  if v_station.type = 'main' and p_scoring_mode not in ('graded','free','fixed') then raise exception 'BAD_SCORING_MODE'; end if;
  update stations set name_zh = v_name,
    scoring_mode = case when type = 'main' then p_scoring_mode else null end
  where id = p_station_id returning * into v_station;
  return to_jsonb(v_station);
end;
$$;

-- ---------------------------------------------------------------------------
-- 玩家管理
-- ---------------------------------------------------------------------------
create or replace function admin_list_players(p_admin_key text, p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events;
begin
  v_event := _org_event(p_admin_key, p_event_id);
  return coalesce((
    select jsonb_agg(
      _player_json(p.*) || jsonb_build_object(
        'contact', p.contact, 'is_removed', p.is_removed, 'created_at', p.created_at,
        'attempt_count', (select count(*) from attempts a where a.player_id = p.id and a.status in ('passed', 'failed'))
      ) order by p.created_at)
    from players p where p.event_id = v_event.id
  ), '[]'::jsonb);
end;
$$;

create or replace function admin_remove_player(p_admin_key text, p_event_id uuid, p_player_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events;
  v_player players;
begin
  v_event := _org_event(p_admin_key, p_event_id);
  v_player := _get_player_locked(v_event.id, p_player_code);
  update players set is_removed = true where id = v_player.id;
  insert into admin_actions (event_id, player_id, action, reason) values (v_event.id, v_player.id, 'remove', 'soft delete');
  return jsonb_build_object('code', p_player_code, 'removed', true);
end;
$$;

create or replace function admin_adjust(
  p_admin_key text, p_event_id uuid, p_player_code text,
  p_new_score integer default null, p_unlock boolean default false, p_clear_effect boolean default false,
  p_restore_token boolean default false, p_restore boolean default false,
  p_new_next_threshold integer default -1, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events;
  v_player players;
  v_after players;
begin
  v_event := _org_event(p_admin_key, p_event_id);
  select * into v_player from players where event_id = v_event.id and code = p_player_code for update;
  if not found then raise exception 'PLAYER_NOT_FOUND:%', p_player_code; end if;
  if p_unlock then
    update life_event_instances set state = 'cancelled', resolved_at = clock_timestamp()
    where player_id = v_player.id and state = 'pending';
  end if;
  update players set
    score = coalesce(p_new_score, score),
    locked_for_life_event = case when p_unlock then false else locked_for_life_event end,
    pending_threshold = case when p_unlock then null else pending_threshold end,
    status_effect = case when p_clear_effect then null else status_effect end,
    token_available = case when p_restore_token then true else token_available end,
    is_removed = case when p_restore then false else is_removed end,
    next_threshold = case when p_new_next_threshold = -1 then next_threshold
      when p_new_next_threshold = 0 then null else p_new_next_threshold end
  where id = v_player.id returning * into v_after;
  insert into admin_actions (event_id, player_id, action, detail, reason)
  values (v_event.id, v_player.id, 'adjust',
          jsonb_build_object('before', _player_json(v_player), 'after', _player_json(v_after)), p_reason);
  return _player_json(v_after);
end;
$$;

-- ---------------------------------------------------------------------------
-- 访问控制：改机构密码；可选地轮换某一场的工作人员码（返回新码，明文）
-- ---------------------------------------------------------------------------
create or replace function admin_update_access(p_admin_key text, p_new_admin_key text default null, p_rotate_staff_event_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org organizations;
  v_event events;
  v_code text;
  i int;
begin
  v_org := _org_by_admin_key(p_admin_key);
  if p_new_admin_key is not null and (length(p_new_admin_key) < 8 or length(p_new_admin_key) > 64) then
    raise exception 'BAD_NEW_KEY';
  end if;
  if p_new_admin_key is not null then
    update organizations set admin_key = '{sha256}' || encode(extensions.digest(p_new_admin_key, 'sha256'), 'hex')
    where id = v_org.id;
  end if;
  if p_rotate_staff_event_id is not null then
    -- 用已解析出的机构定位场次，不能再拿 p_admin_key 认证一次：
    -- 上面可能刚把密码换掉，旧密码此刻已经不匹配了。
    select * into v_event from events where id = p_rotate_staff_event_id and org_id = v_org.id;
    if not found then raise exception 'EVENT_NOT_FOUND'; end if;
    for i in 1..10 loop
      begin
        v_code := _gen_staff_code();
        update events set staff_code = v_code where id = v_event.id;
        exit;
      exception when unique_violation then
        v_code := null;
      end;
    end loop;
    if v_code is null then raise exception 'TOKEN_GENERATION_FAILED'; end if;
  end if;
  return jsonb_build_object('admin_key_changed', p_new_admin_key is not null, 'staff_code', v_code);
end;
$$;

create or replace function admin_life_event_catalog(p_admin_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform _org_by_admin_key(p_admin_key);
  return _life_event_catalog_json();
end;
$$;

-- ---------------------------------------------------------------------------
-- 权限：公开面全部显式 grant；内部函数在上一份迁移已 revoke
-- ---------------------------------------------------------------------------
revoke execute on function _event_summary_json(events) from public, anon, authenticated;

grant execute on function
  game_landing(text),
  join_by_link(text, text, text, text),
  poll_player_by_link(text, text),
  recover_by_link(text, text),
  choose_life_event_by_link(text, text, uuid, text, text),
  board_snapshot(text),
  life_event_library(),
  staff_session(text),
  staff_lookup(text, text[]),
  staff_lookup_team(text, text),
  award_team_score(text, text, integer, integer, boolean, text),
  use_team_token(text, text, text, integer, text),
  redeem_token_card(text, text, text),
  admin_dashboard(text),
  admin_console(text, uuid),
  admin_event_detail(text, uuid),
  admin_create_event(text, text),
  admin_update_game(text, uuid, text, boolean),
  start_game(text, uuid, jsonb),
  end_game(text, uuid),
  admin_update_station(text, integer, text, text),
  admin_list_players(text, uuid),
  admin_remove_player(text, uuid, text),
  admin_adjust(text, uuid, text, integer, boolean, boolean, boolean, boolean, integer, text),
  admin_update_access(text, text, uuid),
  admin_life_event_catalog(text)
  to anon, authenticated;
