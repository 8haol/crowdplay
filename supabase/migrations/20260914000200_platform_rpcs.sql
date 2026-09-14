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
