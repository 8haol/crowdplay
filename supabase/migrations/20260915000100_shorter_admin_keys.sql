-- Life Passport · 管理口令下限从 8 位降到 4 位
--
-- 业主自己那间机构在生产环境已经在用一个 4 位的口令，8 位下限反而挡住了
-- 他们想设的真实密码。这三个函数是仅有的三处校验管理口令长度的地方
-- （`admin_update_access` 改本机构自己的口令；`platform_create_org` /
-- `platform_reset_key` 是超管在 /root 建机构、重置口令）。上限 64 不变。
--
-- 三个函数的签名都没变，只有长度校验那一行，所以照阶段 2/3 的纪律整体
-- 重贴，不直接改已经上线的迁移文件。

-- 源：20260912000500_tenant_admin_rpcs.sql 第 381 行
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
  if p_new_admin_key is not null and (length(p_new_admin_key) < 4 or length(p_new_admin_key) > 64) then
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

-- 源：20260914000200_platform_rpcs.sql 第 63 行
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
  if p_admin_key is null or length(p_admin_key) not between 4 and 64 then
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

-- 源：20260914000200_platform_rpcs.sql 第 146 行
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
  if p_new_admin_key is null or length(p_new_admin_key) not between 4 and 64 then
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

-- 权限跟着原迁移的口径重新断言一遍（create or replace 本身不动 grant，
-- 这里只是照纪律写明白，不依赖"没被 revoke 过"这件事）。
grant execute on function admin_update_access(text, text, uuid) to anon, authenticated;
grant execute on function platform_create_org(text, text, text, text, text) to anon;
grant execute on function platform_reset_key(text, uuid, text) to anon;
