-- 后台能按站改分，总分跟着差值走，印章和奖项统计不再对不上。
--
-- admin_adjust 只改 players.score，attempts 里那一站的分不动，护照印章 / 站点明细 /
-- 奖项统计（按 attempts 算）全都和总分对不上。新 RPC：
--   admin_set_attempt(p_admin_key, p_event_id, p_player_code, p_station_id, p_score, p_status,
--                     p_whole_team default false, p_reason default null) → _player_json
--     找该玩家在该站的有效 attempt（passed / failed），有就改，没有就补一条（scored_by = 'admin'）；
--     players.score 按差值走，不重算全盘；p_whole_team 时同队每个未移除成员照做，并同步
--     team_attempts 与 teams.challenge_score；分数按 scoring_mode 校验（graded 3/6/9、
--     free 0–10、fixed 6），status = 'failed' 时分数固定为 0（与 award_team_score 一致）；
--     写 admin_actions（action = 'set_attempt'）。
--   admin_player_attempts(p_admin_key, p_event_id, p_player_code) → 每个启用中主站一行
--     [{station_id, name_zh, scoring_mode, score, status}]，没打过的 score / status 为 null。

create or replace function _score_allowed(p_mode text, p_score int)
returns boolean
language sql
immutable
as $$
  select case p_mode
    when 'graded' then p_score in (3, 6, 9)
    when 'free'   then p_score between 0 and 10
    when 'fixed'  then p_score = 6
    else false end
$$;

revoke execute on function _score_allowed(text, int) from public, anon, authenticated;

/* 改一个人在一站的有效成绩；返回这个人总分的差值。 */
create or replace function _set_player_attempt(p_event_id uuid, p_player_id uuid, p_station_id int, p_score int, p_status text)
returns int
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_old attempts;
  v_delta int;
begin
  select * into v_old from attempts
  where player_id = p_player_id and station_id = p_station_id and status in ('passed', 'failed')
  for update;
  if found then
    v_delta := p_score - v_old.score;
    update attempts set score = p_score, status = p_status, scored_by = 'admin' where id = v_old.id;
  else
    v_delta := p_score;
    insert into attempts (event_id, player_id, station_id, score, status, scored_by)
    values (p_event_id, p_player_id, p_station_id, p_score, p_status, 'admin');
  end if;
  update players set score = greatest(0, score + v_delta) where id = p_player_id;
  return v_delta;
end;
$$;

revoke execute on function _set_player_attempt(uuid, uuid, int, int, text) from public, anon, authenticated;

create or replace function admin_set_attempt(p_admin_key text, p_event_id uuid, p_player_code text, p_station_id int,
  p_score int, p_status text, p_whole_team boolean default false, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events;
  v_player players;
  v_station event_stations;
  v_member players;
  v_before jsonb;
  v_before_attempt jsonb;
  v_old_team team_attempts;
  v_score int;
  v_team_delta int;
begin
  v_event := _org_event(p_admin_key, p_event_id);
  select * into v_player from players where event_id = v_event.id and code = trim(coalesce(p_player_code, '')) for update;
  if not found then raise exception 'PLAYER_NOT_FOUND:%', p_player_code; end if;
  select * into v_station from event_stations
  where event_id = v_event.id and station_id = p_station_id and type = 'main';
  if not found then raise exception 'BAD_STATION'; end if;
  if p_status not in ('passed', 'failed') then raise exception 'BAD_STATUS'; end if;
  if p_status = 'failed' then
    v_score := 0;
  else
    if p_score is null or not _score_allowed(v_station.scoring_mode, p_score) then raise exception 'BAD_SCORE'; end if;
    v_score := p_score;
  end if;

  v_before := _player_json(v_player);
  v_before_attempt := (select jsonb_build_object('score', a.score, 'status', a.status) from attempts a
                       where a.player_id = v_player.id and a.station_id = p_station_id and a.status in ('passed', 'failed'));

  if coalesce(p_whole_team, false) and v_player.team_id is not null then
    for v_member in select * from players where team_id = v_player.team_id and not is_removed order by id for update loop
      perform _set_player_attempt(v_event.id, v_member.id, p_station_id, v_score, p_status);
    end loop;
    select * into v_old_team from team_attempts
    where team_id = v_player.team_id and station_id = p_station_id and status in ('passed', 'failed') for update;
    if found then
      v_team_delta := v_score - v_old_team.score;
      update team_attempts set score = v_score, status = p_status, scored_by = 'admin' where id = v_old_team.id;
    else
      v_team_delta := v_score;
      insert into team_attempts (event_id, team_id, station_id, score, status, scored_by)
      values (v_event.id, v_player.team_id, p_station_id, v_score, p_status, 'admin');
    end if;
    update teams set challenge_score = greatest(0, challenge_score + v_team_delta) where id = v_player.team_id;
  else
    perform _set_player_attempt(v_event.id, v_player.id, p_station_id, v_score, p_status);
  end if;

  select * into v_player from players where id = v_player.id;
  insert into admin_actions (event_id, player_id, action, detail, reason)
  values (v_event.id, v_player.id, 'set_attempt',
    jsonb_build_object('station_id', p_station_id, 'score', v_score, 'status', p_status,
                       'whole_team', coalesce(p_whole_team, false),
                       'before_attempt', v_before_attempt,
                       'after_attempt', jsonb_build_object('score', v_score, 'status', p_status),
                       'before', v_before, 'after', _player_json(v_player)),
    nullif(trim(coalesce(p_reason, '')), ''));
  return _player_json(v_player);
end;
$$;

grant execute on function admin_set_attempt(text, uuid, text, int, int, text, boolean, text) to anon;

create or replace function admin_player_attempts(p_admin_key text, p_event_id uuid, p_player_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events;
  v_player players;
begin
  v_event := _org_event(p_admin_key, p_event_id);
  select * into v_player from players where event_id = v_event.id and code = trim(coalesce(p_player_code, ''));
  if not found then raise exception 'PLAYER_NOT_FOUND:%', p_player_code; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'station_id', s.station_id, 'name_zh', s.name_zh, 'scoring_mode', s.scoring_mode,
      'score', a.score, 'status', a.status) order by s.sort_order)
    from event_stations s
    left join attempts a on a.player_id = v_player.id and a.station_id = s.station_id and a.status in ('passed', 'failed')
    where s.event_id = v_event.id and s.type = 'main' and s.disabled_at is null), '[]'::jsonb);
end;
$$;

grant execute on function admin_player_attempts(text, uuid, text) to anon;
