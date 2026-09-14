-- Life Passport · 多租户阶段 3 · 平台级表
--
-- 见 docs/superpowers/specs/2026-09-14-multi-tenant-phase3-design.md
--
-- 业主决定不做 Supabase Auth：继续一个机构一个共享口令，另加一个平台口令给超管。

-- ---------------------------------------------------------------------------
-- 1. 平台口令（单行）
-- ---------------------------------------------------------------------------
create table platform_config (
  id        boolean primary key default true check (id),
  super_key text not null
);
comment on table platform_config is
  '单行。超级管理员口令，格式与 organizations.admin_key 一致（{sha256}<hex>）。';

-- 这里存的是一个谁也没见过的随机值的哈希 —— 迁移文件本身不含任何可用的秘密。
-- 上线后在 Supabase Studio 跑一次 update 设成真正的口令（见 RUNBOOK）。
insert into platform_config (id, super_key)
values (true, '{sha256}' || encode(extensions.digest(_gen_hex_token(), 'sha256'), 'hex'));

-- ---------------------------------------------------------------------------
-- 2. 代入令牌
-- ---------------------------------------------------------------------------
create table admin_sessions (
  token      text primary key,
  org_id     uuid not null references organizations (id) on delete cascade,
  expires_at timestamptz not null
);
comment on table admin_sessions is
  '超管「代入某机构」铸出的短期令牌。_org_by_admin_key 在机构口令匹配失败后认它。';

create index admin_sessions_expires_idx on admin_sessions (expires_at);

-- ---------------------------------------------------------------------------
-- 3. 收权：两张表只能经 security definer 的 RPC 触达
-- ---------------------------------------------------------------------------
alter table platform_config enable row level security;
alter table admin_sessions  enable row level security;
revoke all on table platform_config from public, anon, authenticated;
revoke all on table admin_sessions  from public, anon, authenticated;
