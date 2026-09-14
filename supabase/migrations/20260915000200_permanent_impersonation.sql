-- Life Passport · 代入令牌不再过期
--
-- 业主原话:「什么叫令牌两小时后失效？超级管理员应该可以一直无限制访问任何
-- 机构啊。」——去掉 2 小时有效期,超管代入某机构后,这张令牌永久有效,直到
-- 那间机构被删除(级联)或者再次代入把它换掉。
--
-- 20260914000100/200/300 三个文件已经上线,不能改;这里新开一个迁移,按
-- 「整段重贴,只改要改的地方」的纪律处理。

-- ---------------------------------------------------------------------------
-- 1. 表结构:去掉 expires_at,加「一机构一行」的约束
-- ---------------------------------------------------------------------------
-- 不留一个永远是 null 的僵尸列——过期这件事彻底不存在了,连列带索引一起删。
drop index if exists admin_sessions_expires_idx;
alter table admin_sessions drop column expires_at;

-- 每间机构只留一行:代入变成幂等操作,重复点「代入」不会在这张表里堆令牌。
-- 这也是下面 upsert 能用 on conflict (org_id) 的前提。
alter table admin_sessions add constraint admin_sessions_org_id_key unique (org_id);

comment on table admin_sessions is
  '超管「代入某机构」铸出的令牌,一机构一行,永不过期。_org_by_admin_key 在'
  '机构口令匹配失败后认它;机构被删时随 on delete cascade 一起没了。';

-- ---------------------------------------------------------------------------
-- 2. platform_impersonate:不再铸「短期」令牌,已有的直接复用
-- ---------------------------------------------------------------------------
-- 源:20260914000200_platform_rpcs.sql 第 211 行
create or replace function platform_impersonate(p_platform_key text, p_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org   organizations;
  v_token text;
begin
  perform _platform_guard(p_platform_key);

  select * into v_org from organizations where id = p_org_id;
  if not found then raise exception 'ORG_NOT_FOUND'; end if;

  -- 业主决定:超管应该能无限制、永久访问任何机构,所以令牌不设有效期,
  -- 也不再需要「顺手清过期行」的打扫逻辑——过期这件事已经不存在了。
  -- 一机构一行:已经有令牌就原样返回那一个(on conflict 里的 update 是个
  -- 空操作,只是为了让 returning 能拿到冲突时表里已有的那一行),没有就铸
  -- 一张新的。用 upsert 而不是「先查再插」,避免并发下的插入竞态。
  insert into admin_sessions (token, org_id) values (_gen_hex_token(), p_org_id)
  on conflict (org_id) do update set token = admin_sessions.token
  returning token into v_token;

  return jsonb_build_object('token', v_token, 'org_name', v_org.name_zh);
end;
$$;

grant execute on function platform_impersonate(text, uuid) to anon;

-- ---------------------------------------------------------------------------
-- 3. _org_by_admin_key:去掉「过期即拒」这一段判断
-- ---------------------------------------------------------------------------
-- 源:20260914000300_impersonation.sql 第 9 行
create or replace function _org_by_admin_key(p_admin_key text)
returns organizations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v organizations;
begin
  -- 机构自己的口令。原逻辑,一字未改。
  select o.* into v from organizations o
  where _secret_matches(o.admin_key, p_admin_key)
  limit 1;
  if found then return v; end if;

  -- 超管「代入」铸出的令牌。口令对得上时根本走不到这里。
  -- 不再校验过期时间——业主决定超管应能无限制、永久访问任何机构;这里
  -- 不是漏掉了一道安全闸,是故意去掉的,别再加回来。
  select o.* into v from organizations o
  join admin_sessions s on s.org_id = o.id
  where s.token = p_admin_key
  limit 1;
  if found then return v; end if;

  perform _throttle_failed_attempt('admin-key');
  raise exception 'BAD_KEY';
end;
$$;

revoke execute on function _org_by_admin_key(text) from public, anon, authenticated;
