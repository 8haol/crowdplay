-- Tests: 阶段 3 超级管理员控制台。平台口令、机构列表、增删改、代入令牌。
begin;
delete from events; delete from organizations;
insert into organizations (slug, name_zh, name_en, admin_key) values
  ('alpha', '甲教会', 'Alpha Church', 'alpha-admin'),
  ('beta',  '乙教会', 'Beta Church',  'beta-admin');
insert into events (org_id, title, join_token, staff_code, screen_token, phase)
select id, '甲场', 'join-alpha', 'ALPHA1', 'screen-alpha', 'waiting' from organizations where slug = 'alpha';

-- 测试自己设平台口令：迁移里种下的是随机值，谁也不知道。
update platform_config set super_key = '{sha256}' || encode(extensions.digest('root-pass', 'sha256'), 'hex');

do $$
declare
  r jsonb;
  orgs jsonb;
begin
  -- 1. 错的平台口令
  begin
    perform platform_orgs('wrong-pass');
    raise exception 'TEST FAILED: expected BAD_PLATFORM_KEY';
  exception when others then
    if sqlerrm <> 'BAD_PLATFORM_KEY' then raise; end if;
  end;

  -- 2. 对的平台口令列出两间机构，按 slug 升序
  r := platform_orgs('root-pass');
  orgs := r -> 'orgs';
  assert jsonb_array_length(orgs) = 2, '平台看得到两间机构';
  assert orgs -> 0 ->> 'slug' = 'alpha', '按 slug 升序';
  assert orgs -> 0 ->> 'name_zh' = '甲教会', '带中文名';
  assert (orgs -> 0 ->> 'event_count')::int = 1, '甲教会一场';
  assert (orgs -> 1 ->> 'event_count')::int = 0, '乙教会零场';
  assert not (orgs -> 0 ->> 'has_live_event')::boolean, '甲场还在 waiting，不算进行中';

  -- 3. 机构口令绝不能当平台口令用
  begin
    perform platform_orgs('alpha-admin');
    raise exception 'TEST FAILED: expected BAD_PLATFORM_KEY';
  exception when others then
    if sqlerrm <> 'BAD_PLATFORM_KEY' then raise; end if;
  end;

  raise notice 'PASS 19_platform_console';
end $$;
rollback;
