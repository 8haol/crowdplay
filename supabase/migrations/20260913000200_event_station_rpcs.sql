-- Life Passport · 多租户阶段 2 · 建场时落配置
-- 建场时把站点清单复制进 event_stations：优先复制本机构最近一场，否则用平台内置的 9 个。

-- 建场时落本场站点：优先复制该机构最近一场，否则用平台内置。
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
    insert into event_stations (event_id, station_id, name_zh, type, scoring_mode, sort_order)
    select p_event_id, es.station_id, es.name_zh, es.type, es.scoring_mode, es.sort_order
    from event_stations es where es.event_id = v_prev;
    get diagnostics v_copied = row_count;
  end if;

  -- 上一场存在但名册空（比如它自己也是从空名册来的边缘场次）时，别忠实地复制出 0 个站：
  -- 兜底回到平台内置的 9 个，保证每场都至少有齐全的默认配置。
  if v_prev is null or v_copied = 0 then
    insert into event_stations (event_id, station_id, name_zh, type, scoring_mode, sort_order)
    select p_event_id, s.id, s.name_zh, s.type, s.scoring_mode, s.sort_order
    from stations s where s.org_id is null;
  end if;
end;
$$;

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
      perform _seed_event_stations(v_org.id, v_new.id);
      return _session_admin_json(v_new);
    exception when unique_violation then
      null; -- 6 位码撞了，重新生成
    end;
  end loop;
  raise exception 'TOKEN_GENERATION_FAILED';
end;
$$;

revoke execute on function _seed_event_stations(uuid, uuid) from public, anon, authenticated;
grant execute on function admin_create_event(text, text) to anon;

-- ---------------------------------------------------------------------------
-- 机构库：内置 9 个只读，各机构自建站点只对自己可见/可改
-- ---------------------------------------------------------------------------

create or replace function admin_station_library(p_admin_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_org organizations;
begin
  v_org := _org_by_admin_key(p_admin_key);
  return jsonb_build_object(
    'builtin', coalesce((select jsonb_agg(to_jsonb(s) order by s.sort_order) from stations s where s.org_id is null), '[]'::jsonb),
    'custom',  coalesce((select jsonb_agg(to_jsonb(s) order by s.sort_order) from stations s where s.org_id = v_org.id), '[]'::jsonb)
  );
end;
$$;

/* 机构自建站点。slug 由后端生成：管理员只填名字，slug 只是内部标识。 */
create or replace function admin_library_create(p_admin_key text, p_name_zh text, p_type text, p_scoring_mode text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org organizations;
  v_name text := trim(coalesce(p_name_zh, ''));
  v_row stations;
begin
  v_org := _org_by_admin_key(p_admin_key);
  if length(v_name) < 1 or length(v_name) > 30 then raise exception 'BAD_STATION_NAME'; end if;
  if p_type not in ('main', 'life_event', 'grace') then raise exception 'BAD_STATION_TYPE'; end if;
  if p_type = 'main' and coalesce(p_scoring_mode, '') not in ('graded', 'free', 'fixed') then
    raise exception 'BAD_SCORING_MODE';
  end if;
  insert into stations (org_id, slug, name_zh, type, scoring_mode, sort_order)
  values (v_org.id, v_org.slug || '-' || left(md5(gen_random_uuid()::text), 6), v_name, p_type,
          case when p_type = 'main' then p_scoring_mode else null end,
          coalesce((select max(sort_order) + 1 from stations where org_id = v_org.id), 100))
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

create or replace function admin_library_update(p_admin_key text, p_station_id integer, p_name_zh text, p_scoring_mode text default null, p_sort_order integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org organizations;
  v_row stations;
  v_name text := trim(coalesce(p_name_zh, ''));
begin
  v_org := _org_by_admin_key(p_admin_key);
  select * into v_row from stations where id = p_station_id;
  if not found then raise exception 'BAD_STATION'; end if;
  if v_row.org_id is distinct from v_org.id then raise exception 'FORBIDDEN'; end if;
  if length(v_name) < 1 or length(v_name) > 30 then raise exception 'BAD_STATION_NAME'; end if;
  if v_row.type = 'main' and coalesce(p_scoring_mode, '') not in ('graded', 'free', 'fixed') then
    raise exception 'BAD_SCORING_MODE';
  end if;
  update stations set
    name_zh = v_name,
    scoring_mode = case when type = 'main' then p_scoring_mode else null end,
    sort_order = coalesce(p_sort_order, sort_order)
  where id = p_station_id returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

create or replace function admin_library_copy(p_admin_key text, p_station_id integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org organizations;
  v_src stations;
  v_row stations;
begin
  v_org := _org_by_admin_key(p_admin_key);
  select * into v_src from stations where id = p_station_id;
  if not found then raise exception 'BAD_STATION'; end if;
  if v_src.org_id is not null and v_src.org_id <> v_org.id then raise exception 'FORBIDDEN'; end if;
  insert into stations (org_id, slug, name_zh, type, scoring_mode, sort_order)
  values (v_org.id, v_org.slug || '-' || left(md5(gen_random_uuid()::text), 6), v_src.name_zh, v_src.type, v_src.scoring_mode,
          coalesce((select max(sort_order) + 1 from stations where org_id = v_org.id), 100))
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

create or replace function admin_library_delete(p_admin_key text, p_station_id integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org organizations;
  v_row stations;
begin
  v_org := _org_by_admin_key(p_admin_key);
  select * into v_row from stations where id = p_station_id;
  if not found then raise exception 'BAD_STATION'; end if;
  if v_row.org_id is distinct from v_org.id then raise exception 'FORBIDDEN'; end if;
  -- 「从未被启用过」不能只看 event_stations：attempts / team_attempts / token_usages
  -- 都对 stations(id) 有裸外键（无 on delete 动作），漏查会让 delete 撞上未捕获的
  -- 外键违例，而不是约定好的 STATION_IN_USE。
  if exists (select 1 from event_stations where station_id = p_station_id)
     or exists (select 1 from attempts where station_id = p_station_id)
     or exists (select 1 from team_attempts where station_id = p_station_id)
     or exists (select 1 from token_usages where target_station_id = p_station_id) then
    raise exception 'STATION_IN_USE';
  end if;
  delete from stations where id = p_station_id;
  return jsonb_build_object('deleted', p_station_id);
end;
$$;

grant execute on function admin_station_library(text), admin_library_create(text, text, text, text),
  admin_library_update(text, integer, text, text, integer), admin_library_copy(text, integer),
  admin_library_delete(text, integer) to anon;

-- ---------------------------------------------------------------------------
-- 本场配置：从库里挑站点启用到这一场
-- ---------------------------------------------------------------------------

create or replace function admin_event_stations(p_admin_key text, p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events;
  v_org_id uuid;
begin
  v_event := _org_event(p_admin_key, p_event_id);
  v_org_id := v_event.org_id;
  return jsonb_build_object(
    'phase', v_event.phase,
    'rows', coalesce((select jsonb_agg(to_jsonb(es) order by es.sort_order)
                      from event_stations es where es.event_id = p_event_id), '[]'::jsonb),
    'candidates', coalesce((select jsonb_agg(to_jsonb(s) order by s.sort_order) from stations s
                            where (s.org_id is null or s.org_id = v_org_id)
                              and not exists (select 1 from event_stations es
                                              where es.event_id = p_event_id and es.station_id = s.id)), '[]'::jsonb)
  );
end;
$$;

/* 整份提交本场站点。只在 waiting 阶段可用；删掉已记分的站点会被拒。 */
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
      if coalesce(v_row ->> 'scoring_mode', '') not in ('graded', 'free', 'fixed') then raise exception 'BAD_SCORING_MODE'; end if;
      v_main := v_main + 1;
    elsif v_station.type = 'life_event' then
      v_life := v_life + 1;
    end if;
    v_keep := v_keep || v_station.id;

    insert into event_stations (event_id, station_id, name_zh, type, scoring_mode, sort_order, disabled_at)
    values (p_event_id, v_station.id, trim(v_row ->> 'name_zh'), v_station.type,
            case when v_station.type = 'main' then v_row ->> 'scoring_mode' else null end,
            coalesce((v_row ->> 'sort_order')::int, 0), null)
    on conflict (event_id, station_id) do update
      set name_zh = excluded.name_zh, scoring_mode = excluded.scoring_mode,
          sort_order = excluded.sort_order, disabled_at = null;
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

/* 撤站。waiting 和 playing 都可用；已记的分全部保留。 */
create or replace function admin_disable_event_station(p_admin_key text, p_event_id uuid, p_station_id integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events;
  v_row event_stations;
begin
  v_event := _org_event(p_admin_key, p_event_id);
  if v_event.phase = 'ended' then raise exception 'EVENT_ENDED'; end if;
  select * into v_row from event_stations where event_id = p_event_id and station_id = p_station_id;
  if not found then raise exception 'BAD_STATION'; end if;
  if v_row.type = 'life_event' then raise exception 'LIFE_EVENT_REQUIRED'; end if;
  if v_row.type = 'main' and (select count(*) from event_stations
      where event_id = p_event_id and type = 'main' and disabled_at is null) <= 1 then
    raise exception 'MAIN_STATION_REQUIRED';
  end if;
  update event_stations set disabled_at = now()
  where event_id = p_event_id and station_id = p_station_id and disabled_at is null;
  return admin_event_stations(p_admin_key, p_event_id);
end;
$$;

grant execute on function admin_event_stations(text, uuid), admin_set_event_stations(text, uuid, jsonb),
  admin_disable_event_station(text, uuid, integer) to anon;
