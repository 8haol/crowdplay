-- Life Passport · 多租户阶段 1 · 收口
--
-- 1. 租户表不给 anon / authenticated 任何表级权限。RLS 已经开着且没有策略，
--    所以本来就读不到行；这里是第二道锁，让权限检查本身就说"不行"。
revoke all on table organizations, events from public, anon, authenticated;

-- 2. 被管理员取消的人生事件算"已经历"，不再重发。
--
-- life_event_instances 上有 (player_id, stage) 唯一索引：一段人生只发一次。
-- 但 _next_stage / _sync_life_event 之前把 cancelled 排除在外，于是管理员解锁
-- 之后下一次 sync 会试图再发同一段 → 撞唯一索引 → 录分整笔失败。
-- 管理员按「解锁」的意思是"让这个人别卡在这儿"，所以那一段就此略过。
create or replace function _next_stage(p_player_id uuid)
returns integer
language sql
stable
set search_path = public, pg_temp
as $$
  select min(s) from generate_series(1, 3) s
  where not exists (
    select 1 from life_event_instances i
    where i.player_id = p_player_id and i.stage = s
  );
$$;

create or replace function _sync_life_event(p_player_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_player players;
  v_due int;
  v_stage int;
  v_id uuid;
begin
  select * into v_player from players where id = p_player_id for update;
  if not found or v_player.is_removed then return null; end if;
  if exists (select 1 from life_event_instances where player_id = p_player_id and state = 'pending') then
    return null; -- one pending event per player, by design
  end if;

  v_due := _due_stage(p_player_id);
  if v_due = 0 then return null; end if;

  select min(s) into v_stage from generate_series(1, v_due) s
  where not exists (select 1 from life_event_instances i
                    where i.player_id = p_player_id and i.stage = s);
  if v_stage is null then return null; end if;

  v_id := _create_event_for_player(v_player, v_stage, v_player.score);
  update players set locked_for_life_event = true, pending_stage = v_stage, pending_threshold = null
  where id = p_player_id;
  return v_id;
end;
$$;
