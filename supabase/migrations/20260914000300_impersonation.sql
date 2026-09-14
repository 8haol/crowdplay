-- Life Passport · 多租户阶段 3 · 让管理端认代入令牌
--
-- 见 docs/superpowers/specs/2026-09-14-multi-tenant-phase3-design.md
--
-- 这是阶段 3 对存量代码的唯一改动。机构口令那一段一字未改并提前 return，
-- 所以口令正确的调用碰不到新代码；口令错误的调用多一次主键查询，然后抛同样的 BAD_KEY。
-- _org_event() 内部调用本函数，因此 18 个管理端 RPC 与整个 /admin 前端零改动。

create or replace function _org_by_admin_key(p_admin_key text)
returns organizations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v organizations;
begin
  -- 机构自己的口令。原逻辑，一字未改。
  select o.* into v from organizations o
  where _secret_matches(o.admin_key, p_admin_key)
  limit 1;
  if found then return v; end if;

  -- 超管「代入」铸出的短期令牌。口令对得上时根本走不到这里。
  select o.* into v from organizations o
  join admin_sessions s on s.org_id = o.id
  where s.token = p_admin_key and s.expires_at > now()
  limit 1;
  if found then return v; end if;

  perform _throttle_failed_attempt('admin-key');
  raise exception 'BAD_KEY';
end;
$$;

revoke execute on function _org_by_admin_key(text) from public, anon, authenticated;
