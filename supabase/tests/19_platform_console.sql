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
  v_alpha uuid;
  v_beta uuid;
  ev_alpha uuid;
  v_token text;
  v_gamma uuid;
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

  -- 9a. 新建机构：中文名超长
  begin
    perform platform_create_org('root-pass', 'epsilon', repeat('甲', 41), 'Epsilon Church', 'epsilon-admin');
    raise exception 'TEST FAILED: expected BAD_ORG_NAME';
  exception when others then
    if sqlerrm <> 'BAD_ORG_NAME' then raise; end if;
  end;

  -- 9b. 改名：英文名超长（丙教会还在，才能借它测）
  begin
    perform platform_rename_org('root-pass', v_new_id, '丙教会', repeat('A', 61));
    raise exception 'TEST FAILED: expected BAD_ORG_NAME';
  exception when others then
    if sqlerrm <> 'BAD_ORG_NAME' then raise; end if;
  end;

  -- 10. 重置口令：旧的立刻失效，新的可用
  v_beta := (select id from organizations where slug = 'beta');
  assert (admin_dashboard('beta-admin') -> 'org' ->> 'slug') = 'beta', '重置前旧口令可用';
  perform platform_reset_key('root-pass', v_beta, 'beta-new-key');
  begin
    perform admin_dashboard('beta-admin');
    raise exception 'TEST FAILED: expected BAD_KEY';
  exception when others then
    if sqlerrm <> 'BAD_KEY' then raise; end if;
  end;
  assert (admin_dashboard('beta-new-key') -> 'org' ->> 'slug') = 'beta', '重置后新口令可用';

  -- 11. 重置成太短的口令
  begin
    perform platform_reset_key('root-pass', v_beta, 'tiny');
    raise exception 'TEST FAILED: expected BAD_NEW_KEY';
  exception when others then
    if sqlerrm <> 'BAD_NEW_KEY' then raise; end if;
  end;

  -- 12. 删除：确认 slug 不匹配
  begin
    perform platform_delete_org('root-pass', v_beta, 'not-beta');
    raise exception 'TEST FAILED: expected CONFIRM_MISMATCH';
  exception when others then
    if sqlerrm <> 'CONFIRM_MISMATCH' then raise; end if;
  end;

  -- 13. 删除：机构有进行中的场次时拒绝
  v_alpha := (select id from organizations where slug = 'alpha');
  ev_alpha := (select id from events where join_token = 'join-alpha');
  update events set phase = 'playing' where id = ev_alpha;
  assert (select (x ->> 'has_live_event')::boolean
          from jsonb_array_elements(platform_orgs('root-pass') -> 'orgs') x
          where x ->> 'slug' = 'alpha'), '甲场进行中，应标记为 has_live_event';
  begin
    perform platform_delete_org('root-pass', v_alpha, 'alpha');
    raise exception 'TEST FAILED: expected ORG_HAS_LIVE_EVENT';
  exception when others then
    if sqlerrm <> 'ORG_HAS_LIVE_EVENT' then raise; end if;
  end;
  update events set phase = 'waiting' where id = ev_alpha;

  -- 14. 删除成功，场次级联清掉
  assert (select count(*) from events where org_id = v_alpha) = 1, '删之前甲教会有一场';
  r := platform_delete_org('root-pass', v_alpha, 'alpha');
  assert r ->> 'deleted' = 'alpha', '返回被删的 slug';
  assert (select count(*) from organizations where id = v_alpha) = 0, '机构没了';
  assert (select count(*) from events where org_id = v_alpha) = 0, '场次跟着级联删了';

  -- 15. 删不存在的机构
  begin
    perform platform_delete_org('root-pass', v_alpha, 'alpha');
    raise exception 'TEST FAILED: expected ORG_NOT_FOUND';
  exception when others then
    if sqlerrm <> 'ORG_NOT_FOUND' then raise; end if;
  end;

  -- 16. 代入：令牌能过管理端，且只解锁那一间
  v_gamma := (select id from organizations where slug = 'gamma');
  r := platform_impersonate('root-pass', v_gamma);
  v_token := r ->> 'token';
  assert length(v_token) = 16, '令牌是 16 位十六进制';
  assert (r ->> 'expires_at')::timestamptz
         between now() + interval '119 minutes' and now() + interval '121 minutes',
         '代入令牌的有效期是 2 小时';
  assert r ->> 'org_name' = '丙教会（改）', '返回的机构名是当前名字（丙教会在第 8 步已改名）';
  assert (admin_dashboard(v_token) -> 'org' ->> 'slug') = 'gamma', '代入令牌能进丙教会的管理端';

  -- 拿丙教会的令牌去碰乙教会的场次：报 EVENT_NOT_FOUND，不泄漏别家场次是否存在
  insert into events (org_id, title, join_token, staff_code, screen_token, phase)
  values (v_beta, '乙场', 'join-beta', 'BETA01', 'screen-beta', 'waiting');
  begin
    perform admin_console(v_token, (select id from events where join_token = 'join-beta'));
    raise exception 'TEST FAILED: expected EVENT_NOT_FOUND';
  exception when others then
    if sqlerrm <> 'EVENT_NOT_FOUND' then raise; end if;
  end;

  -- 16a. 代入也要认平台口令：错的口令铸不出令牌
  begin
    perform platform_impersonate('wrong-pass', v_gamma);
    raise exception 'TEST FAILED: expected BAD_PLATFORM_KEY';
  exception when others then
    if sqlerrm <> 'BAD_PLATFORM_KEY' then raise; end if;
  end;

  -- 17. 过期的令牌不认
  update admin_sessions set expires_at = now() - interval '1 minute' where token = v_token;
  begin
    perform admin_dashboard(v_token);
    raise exception 'TEST FAILED: expected BAD_KEY';
  exception when others then
    if sqlerrm <> 'BAD_KEY' then raise; end if;
  end;

  -- 18. 机构自己的口令完全不受影响（回归）
  assert (admin_dashboard('beta-new-key') -> 'org' ->> 'slug') = 'beta', '机构口令照常可用';

  -- 19. 铸新令牌时顺手清掉过期行
  perform platform_impersonate('root-pass', v_gamma);
  assert (select count(*) from admin_sessions where token = v_token) = 0, '过期令牌被顺手清掉了';

  -- 20. 代入不存在的机构
  begin
    perform platform_impersonate('root-pass', '00000000-0000-0000-0000-000000000000');
    raise exception 'TEST FAILED: expected ORG_NOT_FOUND';
  exception when others then
    if sqlerrm <> 'ORG_NOT_FOUND' then raise; end if;
  end;

  raise notice 'PASS 19_platform_console';
end $$;
rollback;
