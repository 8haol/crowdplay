-- 同名再登记先问一句是不是你；忘了编号可以用联系方式找回。
--
-- Glasgow 那场换浏览器的人重新登记，队里少一个人、榜上多一个空号。三层里的服务端两层：
--   1. join_by_link 加 p_force：未 force 且本场已有同名（规范化后）未移除玩家时不建号，
--      返回 {duplicate: {name, code_hint, has_contact, contact_hint}}。
--   2. recover_by_contact：名字 + 联系方式（players.contact，PR #13）同时匹配才返回护照。
-- 规范化与前端 Join.tsx 的 normalizedName 同规则：去空白（含全角空格）、忽略大小写。

create or replace function _normalize_name(p text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(translate(coalesce(p, ''), '　', ' '), '\s+', '', 'g'))
$$;

revoke execute on function _normalize_name(text) from public, anon, authenticated;

-- 源：20260912000300_tenant_player_rpcs.sql（逐字重贴，只加 p_force 与撞名分支）
drop function if exists join_by_link(text, text, text, text);
create or replace function join_by_link(p_name text, p_join_token text, p_contact text default null,
                                        p_idempotency_key text default null, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events;
  v_name text := trim(coalesce(p_name, ''));
  v_contact text := nullif(trim(coalesce(p_contact, '')), '');
  v_idem text;
  v_previous jsonb;
  v_new record;
  v_team uuid;
  v_color text;
  v_result jsonb;
  v_dup players;
begin
  v_event := _event_by('join', p_join_token);
  -- 行锁串行化同一场的报名：两个并发重试不会各自漏看 rpc_results 而建出两行。
  select * into v_event from events where id = v_event.id for update;

  if v_event.phase = 'ended' then raise exception 'GAME_ARCHIVED'; end if;
  if not v_event.join_open then raise exception 'JOIN_CLOSED'; end if;
  if length(v_name) < 1 or length(v_name) > 20 then raise exception 'BAD_NAME'; end if;
  if v_contact is not null and length(v_contact) > 80 then raise exception 'BAD_CONTACT'; end if;

  if nullif(trim(coalesce(p_idempotency_key, '')), '') is not null then
    v_idem := 'join:' || v_event.id::text || ':' || trim(p_idempotency_key);
    select result into v_previous from rpc_results where idempotency_key = v_idem;
    if found then return v_previous; end if;
  end if;

  -- 撞名：本场已有同名未移除玩家时先问一句，不建号也不写 rpc_results。
  if not coalesce(p_force, false) then
    select * into v_dup from players
    where event_id = v_event.id and not is_removed and _normalize_name(name) = _normalize_name(v_name)
    order by created_at, id::text limit 1;
    if found then
      return jsonb_build_object('duplicate', jsonb_build_object(
        'name', v_dup.name,
        'code_hint', left(v_dup.code, 1) || '●●',
        'has_contact', v_dup.contact is not null,
        'contact_hint', case when v_dup.contact is null then null
                             else left(v_dup.contact, 2) || '…' || right(v_dup.contact, 2) end));
    end if;
  end if;

  select * into v_new from _new_player_code(v_event.id, v_name);
  update players set contact = v_contact where id = v_new.player_id;

  -- 开局后来的人自成一个 Solo 队，不打扰已经在闯关的 Duo / Trio。
  if v_event.phase = 'playing' then
    v_color := 'solo-' || (((select count(*) from teams where event_id = v_event.id and identity = 'solo') % 8) + 1)::text;
    v_team := _make_team(v_event.id, 'solo', v_color);
    update players set identity = 'solo', color_group = v_color, team_id = v_team
    where id = v_new.player_id;
  end if;

  v_result := jsonb_build_object(
    'player_id', v_new.player_id,
    'code', v_new.code,
    'event_id', v_event.id,
    'title', v_event.title
  );
  if v_idem is not null then
    insert into rpc_results (event_id, idempotency_key, result) values (v_event.id, v_idem, v_result);
  end if;
  return v_result;
end;
$$;

revoke execute on function join_by_link(text, text, text, text, boolean) from public;
grant execute on function join_by_link(text, text, text, text, boolean) to anon, authenticated;

-- 忘了编号：名字 + 联系方式同时匹配。失败路径与 recover_by_link 一样走节流。
create or replace function recover_by_contact(p_join_token text, p_name text, p_contact text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events;
  v players;
begin
  v_event := _event_by('join', p_join_token);
  select * into v from players
  where event_id = v_event.id and not is_removed
    and _normalize_name(name) = _normalize_name(p_name)
    and contact is not null
    and lower(trim(contact)) = lower(trim(coalesce(p_contact, '')))
  order by created_at, id::text limit 1;
  if not found then
    perform _throttle_failed_attempt('recover_identity');
    raise exception 'PLAYER_NOT_FOUND:contact';
  end if;
  return _player_json(v);
end;
$$;

revoke execute on function recover_by_contact(text, text, text) from public;
grant execute on function recover_by_contact(text, text, text) to anon, authenticated;
