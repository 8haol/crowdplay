-- Tests: 自定义工作人员码。归一化、格式校验、撞车、跨机构撞车、不给就随机。
begin;
delete from events; delete from organizations;
insert into organizations (slug, name_zh, name_en, admin_key) values
  ('alpha', '甲教会', 'Alpha Church', 'alpha-admin'),
  ('beta',  '乙教会', 'Beta Church',  'beta-admin');

do $$
declare
  v_alpha uuid := (select id from organizations where slug = 'alpha');
  v_beta  uuid := (select id from organizations where slug = 'beta');
  ev_a uuid; ev_a2 uuid; ev_b uuid;
  r jsonb;
  v_before text;
begin
  insert into events (org_id, title, join_token, staff_code, screen_token, phase)
  values (v_alpha, '甲场一', 'j1', 'AAA111', 's1', 'waiting') returning id into ev_a;
  insert into events (org_id, title, join_token, staff_code, screen_token, phase)
  values (v_alpha, '甲场二', 'j2', 'AAA222', 's2', 'waiting') returning id into ev_a2;
  insert into events (org_id, title, join_token, staff_code, screen_token, phase)
  values (v_beta,  '乙场',   'j3', 'BBB333', 's3', 'waiting') returning id into ev_b;

  -- 1. 给了码就用它，并且归一化成大写、去掉两头空格
  r := admin_update_access('alpha-admin', null, ev_a, '  grace2026 ');
  assert (r ->> 'staff_code') = 'GRACE2026', '返回归一化之后的码';
  assert (select staff_code from events where id = ev_a) = 'GRACE2026', '码真的写进去了';

  -- 2. 不给码就照旧随机生成六位
  r := admin_update_access('alpha-admin', null, ev_a2);
  assert length(r ->> 'staff_code') = 6, '随机码还是六位';
  assert (r ->> 'staff_code') <> 'AAA222', '换过了';

  -- 3. 格式：太短、太长、带符号、带空格，一律 BAD_STAFF_CODE
  v_before := (select staff_code from events where id = ev_a);
  for i in 1..4 loop
    begin
      perform admin_update_access('alpha-admin', null, ev_a,
        (array['ABC', 'ABCDEFGHIJKLM', 'GRACE-2026', 'GRACE 2026'])[i]);
      raise exception 'TEST FAILED: expected BAD_STAFF_CODE';
    exception when others then
      if sqlerrm <> 'BAD_STAFF_CODE' then raise; end if;
    end;
  end loop;
  assert (select staff_code from events where id = ev_a) = v_before, '校验失败时旧码原封不动';

  -- 4. 同机构撞车
  begin
    perform admin_update_access('alpha-admin', null, ev_a2, 'GRACE2026');
    raise exception 'TEST FAILED: expected STAFF_CODE_TAKEN';
  exception when others then
    if sqlerrm <> 'STAFF_CODE_TAKEN' then raise; end if;
  end;

  -- 5. 跨机构也撞车：staff_code 是全表唯一，别的教会占着就是占着
  begin
    perform admin_update_access('beta-admin', null, ev_b, 'GRACE2026');
    raise exception 'TEST FAILED: expected STAFF_CODE_TAKEN';
  exception when others then
    if sqlerrm <> 'STAFF_CODE_TAKEN' then raise; end if;
  end;
  assert (select staff_code from events where id = ev_b) = 'BBB333', '乙的码没被动过';

  -- 6. 设成自己现在这个码不算撞车
  r := admin_update_access('alpha-admin', null, ev_a, 'GRACE2026');
  assert (r ->> 'staff_code') = 'GRACE2026', '重复设成同一个码是允许的';

  -- 7. 跨机构改不动别人的场次
  begin
    perform admin_update_access('beta-admin', null, ev_a, 'BETA9999');
    raise exception 'TEST FAILED: expected EVENT_NOT_FOUND';
  exception when others then
    if sqlerrm <> 'EVENT_NOT_FOUND' then raise; end if;
  end;
  assert (select staff_code from events where id = ev_a) = 'GRACE2026', '甲的码没被乙改掉';

  raise notice 'PASS 21_custom_staff_code';
end $$;
rollback;
