-- Life Passport · 删除活动
--
-- 后台一直没有这个能力：建错一场、或者测试跑完想清掉，只能开 Supabase 手删。
-- 业主定的是「分级」——建错的（没开始、没人报名）点一下就删；已经有人、
-- 或者已经跑完的，必须手敲活动名称确认，因为那一下会连带删掉真实记录。
--
-- 真删，不做软删／归档：软删会让测试场次永远积在库里，列表还要多一个状态。
-- 指向 events 的 10 个外键全部是 on delete cascade（admin_actions、rpc_results、
-- players、teams、attempts、team_attempts、life_events、life_event_instances、
-- token_usages、event_stations），所以一句 delete 就干净，这里不需要显式清理。

create or replace function admin_delete_event(
  p_admin_key text,
  p_event_id uuid,
  p_confirm text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event   events;
  v_players int;
begin
  -- 机构隔离交给 _org_event：口令不对抛 BAD_KEY，场次不属于本机构抛 EVENT_NOT_FOUND。
  v_event := _org_event(p_admin_key, p_event_id);

  -- 进行中的一场正在被工作人员和玩家的手机同时用着，删它没有任何合理场景。
  --
  -- 用自己的错误码而不是复用 EVENT_IN_PROGRESS：那个码今天挂着一句针对
  -- 站点名单的补救建议（「临时缺人手请用『撤站』」），对"想删活动"的人是
  -- 答非所问。两种情形的处置办法不同，就该是两个码。
  if v_event.phase = 'playing' then
    raise exception 'EVENT_PLAYING';
  end if;

  select count(*) into v_players from players where event_id = v_event.id;

  -- 「没开始过且没人报名」＝ 建错的场，删了不损失任何真实记录，免确认。
  -- 其余一律要求手敲名称：严格等于，不 trim、不忽略大小写——这道确认的
  -- 全部意义就是逼人看清自己在删哪一场。
  if not (v_event.phase = 'waiting' and v_players = 0) then
    if p_confirm is null or p_confirm <> v_event.title then
      raise exception 'TITLE_MISMATCH';
    end if;
  end if;

  delete from events where id = v_event.id;

  return jsonb_build_object(
    'id', v_event.id,
    'title', v_event.title,
    'players_deleted', v_players
  );
end;
$$;

grant execute on function admin_delete_event(text, uuid, text) to anon, authenticated;
