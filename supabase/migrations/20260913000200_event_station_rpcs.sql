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
  if exists (select 1 from event_stations where station_id = p_station_id) then raise exception 'STATION_IN_USE'; end if;
  delete from stations where id = p_station_id;
  return jsonb_build_object('deleted', p_station_id);
end;
$$;

grant execute on function admin_station_library(text), admin_library_create(text, text, text, text),
  admin_library_update(text, integer, text, text, integer), admin_library_copy(text, integer),
  admin_library_delete(text, integer) to anon;
