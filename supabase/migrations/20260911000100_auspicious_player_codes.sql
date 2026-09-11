-- Life Passport · 人生编号避开不吉利的数字
--
-- 这个三位数不是数据库主键，而是玩家当晚的名字：在每个站点被大声念出来，
-- 印在带回家的护照上，也是结算时唯一的凭证。所以带有不好联想的号码
-- 直接从池子里拿掉，而不是发出去之后再靠人工换。
--
-- 规则：
--   * 任何含 4 的号码 —— 四 / 死。这一刀覆盖 444、244、344、14x、x4x、x44 全家。
--   * 666 —— 启示录里兽的数字；这是教会迎新会。
--   * 250 —— 二百五。
--   * 100 以下不可能出现：号码固定三位且首位非零。
--
-- 可用池 = 8 × 9 × 9 − 2 = 646 个号码，约 50 人的场次绰绰有余。

create or replace function _player_code_allowed(p_code text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_code ~ '^[1-9][0-9]{2}$'
     and position('4' in p_code) = 0
     and p_code not in ('666', '250');
$$;

comment on function _player_code_allowed(text) is
  '人生编号是否可以发给玩家。改这里就能调整避讳规则。';

-- 抽号方式从「随机猜 + 撞了重试」改成「直接从可用集合里抽」。
-- 号码池被挖掉 28% 之后，猜测法的空转次数会随到场人数上升；
-- 直接抽则永远一次命中，并且池子真的见底时会立刻报错而不是默默转 200 圈。
create or replace function _new_player_code(p_name text)
returns table (player_id uuid, code text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text;
  v_id uuid;
  i int;
begin
  for i in 1..20 loop
    select pool.c into v_code
    from (select g::text as c from generate_series(100, 999) g) pool
    where _player_code_allowed(pool.c)
      and not exists (select 1 from players p where p.code = pool.c)
    order by random()
    limit 1;

    if v_code is null then
      raise exception 'CODE_POOL_EXHAUSTED';
    end if;

    begin
      insert into players (name, code) values (p_name, v_code) returning players.id into v_id;
      player_id := v_id;
      code := v_code;
      return next;
      return;
    exception when unique_violation then
      -- 抽号和写入之间被另一个报名占走了，重抽。
      v_id := null;
    end;
  end loop;
  raise exception 'CODE_POOL_EXHAUSTED';
end;
$$;

revoke execute on function
  _player_code_allowed(text), _new_player_code(text)
  from public, anon, authenticated;
