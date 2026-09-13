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
begin
  select e.id into v_prev from events e
  where e.org_id = p_org_id and e.id <> p_event_id
  order by e.created_at desc limit 1;

  if v_prev is not null then
    insert into event_stations (event_id, station_id, name_zh, type, scoring_mode, sort_order)
    select p_event_id, es.station_id, es.name_zh, es.type, es.scoring_mode, es.sort_order
    from event_stations es where es.event_id = v_prev;
  else
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
