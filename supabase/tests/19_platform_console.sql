-- Tests: 阶段 3 超级管理员控制台。平台口令、机构列表、增删改、代入令牌。
begin;
delete from events; delete from organizations;
-- 插入顺序故意与字母序相反（先 beta 后 alpha），这样「按 slug 升序」的断言
-- 才是真的在验证排序，而不是巧合地跟插入顺序一致。
insert into organizations (slug, name_zh, name_en, admin_key) values
  ('beta',  '乙教会', 'Beta Church',  'beta-admin'),
  ('alpha', '甲教会', 'Alpha Church', 'alpha-admin');
insert into events (org_id, title, join_token, staff_code, screen_token, phase)
select id, '甲场', 'join-alpha', 'ALPHA1', 'screen-alpha', 'waiting' from organizations where slug = 'alpha';

-- 测试自己设平台口令：迁移里种下的是随机值，谁也不知道。
update platform_config set super_key = '{sha256}' || encode(extensions.digest('root-pass', 'sha256'), 'hex');

do $$
declare
  r jsonb;
  orgs jsonb;
  v_new_id uuid;
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

  -- 4. 新建机构
  r := platform_create_org('root-pass', 'gamma', '丙教会', 'Gamma Church', 'gamma-admin');
  v_new_id := (r ->> 'id')::uuid;
  assert r ->> 'slug' = 'gamma', '返回新机构的 slug';
  assert jsonb_array_length(platform_orgs('root-pass') -> 'orgs') = 3, '列表里多了一间';

  -- 新机构的初始口令立刻能用
  assert (admin_dashboard('gamma-admin') -> 'org' ->> 'slug') = 'gamma', '新机构口令可登录';

  -- 5. slug 重复
  begin
    perform platform_create_org('root-pass', 'gamma', '重名', 'Dup', 'another-key');
    raise exception 'TEST FAILED: expected SLUG_TAKEN';
  exception when others then
    if sqlerrm <> 'SLUG_TAKEN' then raise; end if;
  end;

  -- 6. slug 格式非法
  begin
    perform platform_create_org('root-pass', 'Bad Slug!', '丁教会', 'Delta', 'delta-admin');
    raise exception 'TEST FAILED: expected BAD_SLUG';
  exception when others then
    if sqlerrm <> 'BAD_SLUG' then raise; end if;
  end;

  -- 7. 口令太短
  begin
    perform platform_create_org('root-pass', 'delta', '丁教会', 'Delta Church', 'short');
    raise exception 'TEST FAILED: expected BAD_NEW_KEY';
  exception when others then
    if sqlerrm <> 'BAD_NEW_KEY' then raise; end if;
  end;

  -- 8. 改名：slug 不变，名字变
  perform platform_rename_org('root-pass', v_new_id, '丙教会（改）', 'Gamma Church Renamed');
  orgs := platform_orgs('root-pass') -> 'orgs';
  assert (select count(*) from jsonb_array_elements(orgs) x
          where x ->> 'slug' = 'gamma' and x ->> 'name_zh' = '丙教会（改）') = 1,
         '改名生效且 slug 不变';

  -- 9. 改不存在的机构
  begin
    perform platform_rename_org('root-pass', '00000000-0000-0000-0000-000000000000', 'x', 'y');
    raise exception 'TEST FAILED: expected ORG_NOT_FOUND';
  exception when others then
    if sqlerrm <> 'ORG_NOT_FOUND' then raise; end if;
  end;

  raise notice 'PASS 19_platform_console';
end $$;
rollback;
