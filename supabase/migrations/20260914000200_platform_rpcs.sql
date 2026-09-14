-- Life Passport · 多租户阶段 3 · 平台级 RPC
--
-- 见 docs/superpowers/specs/2026-09-14-multi-tenant-phase3-design.md

-- ---------------------------------------------------------------------------
-- 口令闸门。限流用独立 scope，爆破 /root 不会连带锁住 /admin。
-- ---------------------------------------------------------------------------
create or replace function _platform_guard(p_platform_key text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from platform_config where _secret_matches(super_key, p_platform_key)
  ) then
    perform _throttle_failed_attempt('platform-key');
    raise exception 'BAD_PLATFORM_KEY';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 机构列表
-- ---------------------------------------------------------------------------
create or replace function platform_orgs(p_platform_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  perform _platform_guard(p_platform_key);
  select coalesce(jsonb_agg(t.row order by t.slug), '[]'::jsonb) into v
  from (
    select o.slug, jsonb_build_object(
      'id', o.id,
      'slug', o.slug,
      'name_zh', o.name_zh,
      'name_en', o.name_en,
      'created_at', o.created_at,
      'event_count', (select count(*) from events e where e.org_id = o.id),
      'last_event_at', (select max(e.created_at) from events e where e.org_id = o.id),
      'has_live_event', exists (
        select 1 from events e where e.org_id = o.id and e.phase = 'playing')
    ) as row
    from organizations o
  ) t;
  return jsonb_build_object('orgs', v);
end;
$$;

revoke execute on function _platform_guard(text) from public, anon, authenticated;
grant execute on function platform_orgs(text) to anon;

-- ---------------------------------------------------------------------------
-- 新建机构。不预建场次：新机构第一次建场时 _seed_event_stations 会走
-- 「平台内置 9 站」兜底分支（阶段 2），所以开箱即用。
-- ---------------------------------------------------------------------------
create or replace function platform_create_org(
  p_platform_key text,
  p_slug text,
  p_name_zh text,
  p_name_en text,
  p_admin_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org     organizations;
  v_name_zh text := btrim(p_name_zh);
  v_name_en text := btrim(p_name_en);
begin
  perform _platform_guard(p_platform_key);

  -- 显式校验而不是让表上的 check 抛裸约束错：前端要拿到干净的错误码。
  -- 按 trim 后的长度校验并落库 trim 后的值——这个函数对 anon 开放，前端的
  -- .trim() 只是体验，挡不住直接调用 RPC 传一堆空格进来。
  if p_slug is null or p_slug !~ '^[a-z0-9][a-z0-9-]{1,30}$' then
    raise exception 'BAD_SLUG';
  end if;
  if v_name_zh is null or length(v_name_zh) not between 1 and 40
     or v_name_en is null or length(v_name_en) not between 1 and 60 then
    raise exception 'BAD_ORG_NAME';
  end if;
  if p_admin_key is null or length(p_admin_key) not between 8 and 64 then
    raise exception 'BAD_NEW_KEY';
  end if;
  if exists (select 1 from organizations where slug = p_slug) then
    raise exception 'SLUG_TAKEN';
  end if;

  insert into organizations (slug, name_zh, name_en, admin_key)
  values (p_slug, v_name_zh, v_name_en,
          '{sha256}' || encode(extensions.digest(p_admin_key, 'sha256'), 'hex'))
  returning * into v_org;

  return jsonb_build_object('id', v_org.id, 'slug', v_org.slug);
end;
$$;

-- ---------------------------------------------------------------------------
-- 改名。slug 不可改 —— 它将来是 /o/:slug 的地址。
-- ---------------------------------------------------------------------------
create or replace function platform_rename_org(
  p_platform_key text,
  p_org_id uuid,
  p_name_zh text,
  p_name_en text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org     organizations;
  v_name_zh text := btrim(p_name_zh);
  v_name_en text := btrim(p_name_en);
begin
  perform _platform_guard(p_platform_key);
  if v_name_zh is null or length(v_name_zh) not between 1 and 40
     or v_name_en is null or length(v_name_en) not between 1 and 60 then
    raise exception 'BAD_ORG_NAME';
  end if;

  update organizations set name_zh = v_name_zh, name_en = v_name_en
  where id = p_org_id
  returning * into v_org;
  if not found then raise exception 'ORG_NOT_FOUND'; end if;

  return jsonb_build_object('id', v_org.id, 'name_zh', v_org.name_zh, 'name_en', v_org.name_en);
end;
$$;

grant execute on function platform_create_org(text, text, text, text, text),
  platform_rename_org(text, uuid, text, text) to anon;

-- ---------------------------------------------------------------------------
-- 重置某机构的口令。教会忘了口令时用。已经铸出去的代入令牌不受影响（另一张表）。
-- ---------------------------------------------------------------------------
create or replace function platform_reset_key(
  p_platform_key text,
  p_org_id uuid,
  p_new_admin_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org organizations;
begin
  perform _platform_guard(p_platform_key);
  if p_new_admin_key is null or length(p_new_admin_key) not between 8 and 64 then
    raise exception 'BAD_NEW_KEY';
  end if;

  update organizations
     set admin_key = '{sha256}' || encode(extensions.digest(p_new_admin_key, 'sha256'), 'hex')
   where id = p_org_id
  returning * into v_org;
  if not found then raise exception 'ORG_NOT_FOUND'; end if;

  return jsonb_build_object('id', v_org.id, 'slug', v_org.slug);
end;
$$;

-- ---------------------------------------------------------------------------
-- 删除机构。级联清掉它名下的一切，不可恢复（业主确认不要回收站、不要审计）。
-- 两道闸：手打 slug 确认，以及不允许在活动进行中删。
-- ---------------------------------------------------------------------------
create or replace function platform_delete_org(
  p_platform_key text,
  p_org_id uuid,
  p_confirm_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org organizations;
begin
  perform _platform_guard(p_platform_key);

  select * into v_org from organizations where id = p_org_id;
  if not found then raise exception 'ORG_NOT_FOUND'; end if;
  if p_confirm_slug is distinct from v_org.slug then raise exception 'CONFIRM_MISMATCH'; end if;
  if exists (select 1 from events where org_id = p_org_id and phase = 'playing') then
    raise exception 'ORG_HAS_LIVE_EVENT';
  end if;

  delete from organizations where id = p_org_id;
  return jsonb_build_object('deleted', v_org.slug);
end;
$$;

grant execute on function platform_reset_key(text, uuid, text),
  platform_delete_org(text, uuid, text) to anon;

-- ---------------------------------------------------------------------------
-- 代入某机构：铸一张 2 小时的令牌。前端把它塞进 /admin 用的那个 sessionStorage 位，
-- 对 /admin 而言它就是一个普通的机构口令 —— 管理端代码一行都不用改。
-- 令牌不可续期、不可撤销；过期即失效，重新代入就是再铸一张。
-- ---------------------------------------------------------------------------
create or replace function platform_impersonate(p_platform_key text, p_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org     organizations;
  v_token   text;
  v_expires timestamptz;
begin
  perform _platform_guard(p_platform_key);

  select * into v_org from organizations where id = p_org_id;
  if not found then raise exception 'ORG_NOT_FOUND'; end if;

  -- 顺手打扫，不需要定时任务。
  delete from admin_sessions where expires_at < now();

  v_token := _gen_hex_token();
  v_expires := now() + interval '2 hours';
  insert into admin_sessions (token, org_id, expires_at) values (v_token, p_org_id, v_expires);

  return jsonb_build_object('token', v_token, 'expires_at', v_expires, 'org_name', v_org.name_zh);
end;
$$;

grant execute on function platform_impersonate(text, uuid) to anon;
