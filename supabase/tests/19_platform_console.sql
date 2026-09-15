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
  v_beta_token text;
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

  -- 2a. 这两间机构是靠 insert 直接种的，从没经过任何写 admin_key 的 RPC，
  -- 明文从没记录过：platform_orgs 必须报 null，不能是空字符串（空字符串
  -- 看起来像"密码就是空的"，比 null 更危险）。
  assert orgs -> 0 -> 'admin_key_plain' = 'null'::jsonb, '甲教会口令明文从未记录，是 null 而非空串';
  assert (orgs -> 0 ->> 'admin_key_plain') is null, 'admin_key_plain 取出来是 SQL null';

  -- 3. 机构口令绝不能当平台口令用
  begin
    perform platform_orgs('alpha-admin');
    raise exception 'TEST FAILED: expected BAD_PLATFORM_KEY';
  exception when others then
    if sqlerrm <> 'BAD_PLATFORM_KEY' then raise; end if;
  end;

  -- 3a. 反过来，平台口令绝不能当机构口令用（/root 的登录校验必须走
  -- platform_orgs，不能走 admin_dashboard——这条断言只证明了数据库这一侧
  -- 的不变量，证不了前端真的调用了 platform_orgs，那部分靠人工走查）。
  begin
    perform admin_dashboard('root-pass');
    raise exception 'TEST FAILED: expected BAD_KEY';
  exception when others then
    if sqlerrm <> 'BAD_KEY' then raise; end if;
  end;

  -- 4. 新建机构
  r := platform_create_org('root-pass', 'gamma', '丙教会', 'Gamma Church', 'gamma-admin');
  v_new_id := (r ->> 'id')::uuid;
  assert r ->> 'slug' = 'gamma', '返回新机构的 slug';
  assert jsonb_array_length(platform_orgs('root-pass') -> 'orgs') = 3, '列表里多了一间';

  -- 新机构的初始口令立刻能用
  assert (admin_dashboard('gamma-admin') -> 'org' ->> 'slug') = 'gamma', '新机构口令可登录';

  -- 4a. 新建机构存的明文就是传进去的那个口令，platform_orgs 能读出来——
  -- 不是随便什么非空值都算过，得真的等于 'gamma-admin'。
  assert (select x ->> 'admin_key_plain' from jsonb_array_elements(platform_orgs('root-pass') -> 'orgs') x
          where x ->> 'slug' = 'gamma') = 'gamma-admin',
         '新建机构存下的明文口令与传入值一致';

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

  -- 7. 口令太短（新下限是 4 位，这里用 3 位才该踩到这条分支）
  begin
    perform platform_create_org('root-pass', 'delta', '丁教会', 'Delta Church', 'sht');
    raise exception 'TEST FAILED: expected BAD_NEW_KEY';
  exception when others then
    if sqlerrm <> 'BAD_NEW_KEY' then raise; end if;
  end;

  -- 7a. 4 位口令现在合法：新下限确实生效，不是只把报错行数改了
  r := platform_create_org('root-pass', 'delta', '丁教会', 'Delta Church', '1234');
  assert (admin_dashboard('1234') -> 'org' ->> 'slug') = 'delta', '4 位新口令建好即可登录';

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

  -- 9c. 新建机构：名字全是空格——服务端要按 trim 后的长度校验，不能被
  -- 一串空格绕过（前端的 .trim() 挡不住直接调用 RPC）。
  begin
    perform platform_create_org('root-pass', 'zeta', repeat(' ', 40), 'Zeta Church', 'zeta-admin');
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

  -- 10a. 重置口令不能只改哈希：platform_orgs 里乙教会的明文必须跟着变成
  -- 新口令，而不是停留在旧值或变成 null。
  assert (select x ->> 'admin_key_plain' from jsonb_array_elements(platform_orgs('root-pass') -> 'orgs') x
          where x ->> 'slug' = 'beta') = 'beta-new-key',
         'platform_reset_key 之后，platform_orgs 返回的明文是新口令';

  -- 11. 重置成太短的口令（3 位，新下限是 4 位）
  begin
    perform platform_reset_key('root-pass', v_beta, 'tny');
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

  -- 16. 代入：令牌立刻能用，且只解锁那一间。业主决定令牌永不过期，所以
  -- 这里不再断言什么有效期——返回的 jsonb 里也确实没有 expires_at 了。
  v_gamma := (select id from organizations where slug = 'gamma');
  r := platform_impersonate('root-pass', v_gamma);
  v_token := r ->> 'token';
  assert length(v_token) = 16, '令牌是 16 位十六进制';
  assert not (r ? 'expires_at'), '返回结果里不再带 expires_at';
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

  -- 17. 再次代入同一间机构：拿到同一个令牌，admin_sessions 里这间机构
  -- 只留一行——令牌不设过期，重复点「代入」不能每次都多铸一张。
  r := platform_impersonate('root-pass', v_gamma);
  assert r ->> 'token' = v_token, '再次代入同一机构，返回的是同一个令牌';
  assert (select count(*) from admin_sessions where org_id = v_gamma) = 1,
         '同一机构在 admin_sessions 里只留一行';
  assert (admin_dashboard(v_token) -> 'org' ->> 'slug') = 'gamma',
         '令牌不会过期，铸出来多久之后都照样能用';

  -- 18. 机构自己的口令完全不受影响（回归）
  assert (admin_dashboard('beta-new-key') -> 'org' ->> 'slug') = 'beta', '机构口令照常可用';

  -- 19. 不同机构拿到不同的令牌，各自只能解锁自己
  v_beta_token := platform_impersonate('root-pass', v_beta) ->> 'token';
  assert v_beta_token <> v_token, '两间机构代入拿到的令牌不一样';
  assert (admin_dashboard(v_beta_token) -> 'org' ->> 'slug') = 'beta', '乙教会的令牌能进乙教会';

  -- 给丙教会（gamma）建一场，正反两组断言验证：gamma 的令牌能看到自己的场次，
  -- beta 的令牌看不到——不是「场次压根不存在」导致的假阳性。
  insert into events (org_id, title, join_token, staff_code, screen_token, phase)
  values (v_gamma, '丙场', 'join-gamma', 'GAMMA1', 'screen-gamma', 'waiting');
  assert (admin_console(v_token, (select id from events where join_token = 'join-gamma'))
          -> 'org' ->> 'slug') = 'gamma', '丙教会自己的令牌能看到丙场（正对照）';
  begin
    perform admin_console(v_beta_token, (select id from events where join_token = 'join-gamma'));
    raise exception 'TEST FAILED: expected EVENT_NOT_FOUND';
  exception when others then
    if sqlerrm <> 'EVENT_NOT_FOUND' then raise; end if;
  end;

  -- 20. 删除机构：它的令牌跟着级联没了（表的主键是 token 不是 org_id，
  -- 级联删的是「引用了这个 org_id 的行」，不能默认这条链路是对的）
  assert (select count(*) from admin_sessions where org_id = v_gamma) = 1, '删除前令牌还在';
  perform platform_delete_org('root-pass', v_gamma, 'gamma');
  assert (select count(*) from admin_sessions where org_id = v_gamma) = 0,
         '机构删除后，它的代入令牌跟着级联没了';

  -- 21. 代入不存在的机构
  begin
    perform platform_impersonate('root-pass', '00000000-0000-0000-0000-000000000000');
    raise exception 'TEST FAILED: expected ORG_NOT_FOUND';
  exception when others then
    if sqlerrm <> 'ORG_NOT_FOUND' then raise; end if;
  end;

  -- 22. admin_update_access 是教会自己在 /admin 改口令的入口（不经过
  -- /root），最容易被漏掉的一处——它也必须把明文跟着哈希一起更新。
  -- 用第 7a 步建好的 delta（口令 '1234'）来测。
  perform admin_update_access('1234', 'delta-new-99');
  assert (admin_dashboard('delta-new-99') -> 'org' ->> 'slug') = 'delta',
         'admin_update_access 改完口令后，新口令能登录';
  begin
    perform admin_dashboard('1234');
    raise exception 'TEST FAILED: expected BAD_KEY';
  exception when others then
    if sqlerrm <> 'BAD_KEY' then raise; end if;
  end;
  assert (select x ->> 'admin_key_plain' from jsonb_array_elements(platform_orgs('root-pass') -> 'orgs') x
          where x ->> 'slug' = 'delta') = 'delta-new-99',
         'admin_update_access 之后，platform_orgs 返回的明文也是新口令，不是旧的或 null';

  raise notice 'PASS 19_platform_console';
end $$;
rollback;
