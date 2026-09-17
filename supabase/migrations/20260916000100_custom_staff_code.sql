-- Life Passport · 工作人员码可以自己定

-- 同工的码今天只能由服务端随手生成六个字符。教会想发的是一个说得出口、
-- 志愿者听一遍就记得住的码（"GRACE2026"），而不是让每个人对着微信消息
-- 一个字母一个字母地抄 "K7M2PX"。

-- 自定义放在 admin_update_access 里而不是新开一个函数：换码这件事本来就
-- 在这里，分成两个入口反而要在两处重复「用已解析出的机构定位场次」那条
-- 规矩。给 p_staff_code 就用它，不给就照旧随机生成一个。

-- 校验刻意宽松：4–12 位大写字母和数字。生成器的字母表故意避开 I/O/0/1，
-- 因为机器生成的六位码是要被人照着抄的；人自己挑的词是被当成词读的，
-- 拿同一套限制去卡 "GRACE2026" 里的那个 0 只会让人莫名其妙。

-- staff_code 是全表唯一（不是每个机构一套），所以撞车的可能包括别的教会
-- 正在用的码。撞了就报 STAFF_CODE_TAKEN，让前端说人话，而不是把
-- unique_violation 原样甩到屏幕上。

-- 函数多一个参数就是另一个签名，留着旧的三参数版本会让 PostgREST 在两个
-- 重载之间挑，所以先 drop 再整体重贴；grant 也按新签名重新发。

drop function if exists admin_update_access(text, text, uuid);

-- 源：20260915000300_visible_admin_keys.sql 第 32 行
create or replace function admin_update_access(
  p_admin_key text,
  p_new_admin_key text default null,
  p_rotate_staff_event_id uuid default null,
  p_staff_code text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org organizations;
  v_event events;
  v_code text;
  i int;
begin
  v_org := _org_by_admin_key(p_admin_key);
  if p_new_admin_key is not null and (length(p_new_admin_key) < 4 or length(p_new_admin_key) > 64) then
    raise exception 'BAD_NEW_KEY';
  end if;
  if p_new_admin_key is not null then
    update organizations
       set admin_key = '{sha256}' || encode(extensions.digest(p_new_admin_key, 'sha256'), 'hex'),
           admin_key_plain = p_new_admin_key
    where id = v_org.id;
  end if;
  if p_rotate_staff_event_id is not null then
    -- 用已解析出的机构定位场次，不能再拿 p_admin_key 认证一次：
    -- 上面可能刚把密码换掉，旧密码此刻已经不匹配了。
    select * into v_event from events where id = p_rotate_staff_event_id and org_id = v_org.id;
    if not found then raise exception 'EVENT_NOT_FOUND'; end if;

    if p_staff_code is not null then
      v_code := upper(btrim(p_staff_code));
      if v_code !~ '^[A-Z0-9]{4,12}$' then raise exception 'BAD_STAFF_CODE'; end if;
      begin
        update events set staff_code = v_code where id = v_event.id;
      exception when unique_violation then
        raise exception 'STAFF_CODE_TAKEN';
      end;
    else
      for i in 1..10 loop
        begin
          v_code := _gen_staff_code();
          update events set staff_code = v_code where id = v_event.id;
          exit;
        exception when unique_violation then
          v_code := null;
        end;
      end loop;
      if v_code is null then raise exception 'TOKEN_GENERATION_FAILED'; end if;
    end if;
  end if;
  return jsonb_build_object('admin_key_changed', p_new_admin_key is not null, 'staff_code', v_code);
end;
$$;

grant execute on function admin_update_access(text, text, uuid, text) to anon, authenticated;
