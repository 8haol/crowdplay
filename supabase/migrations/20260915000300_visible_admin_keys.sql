-- Life Passport · 让业主在 /root 里看得到机构口令
--
-- 教会忘了密码，打电话/发消息问业主要——业主自己就是密码本，但今天数据库
-- 里只存了 sha256，业主答不上来。这是业主本人拍板、把取舍讲清楚之后做的
-- 决定：从今往后，能读这个数据库的人，读到的是每间教会的明文工作口令，
-- 不再只是哈希。这是刻意的产品决定，不是疏忽——下一个读到这一列的人，
-- 不要「顺手」把它当成遗留漏洞删掉。
--
-- 新增列可空：种子时代那间机构（gcgc）从来没存过明文，只存过哈希，它的
-- 明文永久性地丢了——只能是 null，不能瞎编一个占位符去冒充真口令。
-- 从这份迁移往后，凡是改 admin_key 的地方都必须同时写 admin_key_plain，
-- 否则 /root 会自信地显示一个已经不管用的口令，比什么都不显示更糟。

-- ---------------------------------------------------------------------------
-- 1. 新增列
-- ---------------------------------------------------------------------------
alter table organizations add column admin_key_plain text;
comment on column organizations.admin_key_plain is
  '明文管理口令。业主拍板的产品决定：/root 要能显示每间机构当前的口令，'
  '所以这里额外存一份明文，不再只存 admin_key 的哈希。旧机构（这份迁移'
  '之前就存在的）从未记录过明文，这里是 null——不要"修复"成空字符串，'
  '也不要把这一列当成疏忽删掉。';

-- ---------------------------------------------------------------------------
-- 2. 三个写 admin_key 的函数，一起重贴，让明文跟着哈希一起更新。
--    都只改了「更新/插入 admin_key 的那一句」，签名、其余逻辑不变；按纪律
--    整份重贴，不在线上迁移文件里打补丁。
-- ---------------------------------------------------------------------------

-- 源：20260915000100_shorter_admin_keys.sql 第 12 行（admin_update_access，
-- 教会在 /admin 改自己的口令）。
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
    update organizations
       set admin_key = '{sha256}' || encode(extensions.digest(p_new_admin_key, 'sha256'), 'hex'),
           admin_key_plain = p_new_admin_key
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

-- 源：20260915000100_shorter_admin_keys.sql 第 53 行（platform_create_org，
-- 超管在 /root 新建机构）。
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

  insert into organizations (slug, name_zh, name_en, admin_key, admin_key_plain)
  values (p_slug, v_name_zh, v_name_en,
          '{sha256}' || encode(extensions.digest(p_admin_key, 'sha256'), 'hex'),
          p_admin_key)
  returning * into v_org;

  return jsonb_build_object('id', v_org.id, 'slug', v_org.slug);
end;
$$;

-- 源：20260915000100_shorter_admin_keys.sql 第 98 行（platform_reset_key，
-- 超管在 /root 帮教会重置口令）。
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
     set admin_key = '{sha256}' || encode(extensions.digest(p_new_admin_key, 'sha256'), 'hex'),
         admin_key_plain = p_new_admin_key
   where id = p_org_id
  returning * into v_org;
  if not found then raise exception 'ORG_NOT_FOUND'; end if;

  return jsonb_build_object('id', v_org.id, 'slug', v_org.slug);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. platform_orgs 把明文带出去——这是全库唯一一处对外暴露
--    admin_key_plain 的地方，_platform_guard 挡在前面。
--    源：20260914000200_platform_rpcs.sql 第 27 行，唯一改动是多带一个字段。
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
      'admin_key_plain', o.admin_key_plain,
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

-- ---------------------------------------------------------------------------
-- 4. 权限跟着原迁移的口径重新断言一遍（create or replace 本身不动 grant，
--    这里只是照纪律写明白，不依赖"没被 revoke 过"这件事）。
-- ---------------------------------------------------------------------------
grant execute on function admin_update_access(text, text, uuid) to anon, authenticated;
grant execute on function platform_create_org(text, text, text, text, text) to anon;
grant execute on function platform_reset_key(text, uuid, text) to anon;
grant execute on function platform_orgs(text) to anon;
