-- Life Passport · 大屏颁奖之前，手机上不出现名次

-- 主持人点「结束本场并开始颁奖」的那一刻，大屏开始放颁奖典礼，而每个人的
-- 手机同时收到了自己的最终名次 —— 于是全场低头，典礼放给一屋子头顶看。

-- 名次改成要单独公布一次。押后的判断写在服务端，`poll_player_by_link` 在
-- 押后期间直接把 rank / team_rank 返回 null：只在前端 if 一下的话，名次仍然
-- 躺在每个玩家手机的 JSON 里，刷新时闪一下悬念就没了。押后是一条规则，
-- 不是一层 CSS。

-- 兑底是读取时算出来的，不需要 cron，也不需要谁记得回来点一下：主持人忘了
-- 公布，十五分钟后自己放出来。手机上刻意不显示这个倒计时——显示倒计时等于
-- 请全场盯着手机数秒，正好是这个功能要消灭的行为。

-- ---------------------------------------------------------------------------
-- 1. 新增列 + 回填
-- ---------------------------------------------------------------------------
alter table events add column ranks_published_at timestamptz;
comment on column events.ranks_published_at is
  '主持人把名次公布到玩家手机的时刻。为 null 且本场刚结束不久，玩家手机上'
  '就看不到名次，也生成不了纪念徽章（徽章上印着名次）。';

-- 生产库里已经结束的场次必须保持「已公布」：老玩家回头看自己的徽章，不该
-- 被一个他们从没经历过的新流程拦住。
update events set ranks_published_at = ended_at
where phase = 'ended' and ended_at is not null;

-- ---------------------------------------------------------------------------
-- 2. 「此刻是否押后中」只写一次
-- ---------------------------------------------------------------------------
-- 刻意 fail open：ended_at 为空时算不出兑底时间，那就不押后。宁可提早放出
-- 名次，也不要把玩家永久锁在等待页上。
create or replace function _ranks_held(e events)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select e.phase = 'ended'
     and e.ranks_published_at is null
     and e.ended_at is not null
     and e.ended_at + interval '15 minutes' > now();
$$;

-- ---------------------------------------------------------------------------
-- 3. 公布（控制台第二步）
-- ---------------------------------------------------------------------------
create or replace function publish_ranks(p_admin_key text, p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events;
  v_at timestamptz;
begin
  v_event := _org_event(p_admin_key, p_event_id);
  if v_event.phase <> 'ended' then raise exception 'EVENT_NOT_ENDED'; end if;
  -- 幂等：再点一次不会把公布时间往后推。
  if v_event.ranks_published_at is not null then
    v_at := v_event.ranks_published_at;
  else
    update events set ranks_published_at = now() where id = v_event.id
    returning ranks_published_at into v_at;
  end if;
  return jsonb_build_object('event_id', v_event.id, 'ranks_published_at', v_at);
end;
$$;

grant execute on function publish_ranks(text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. 玩家轮询：押后期间摘掉名次
-- ---------------------------------------------------------------------------
-- 源：20260913000300_event_station_reads.sql 第 876 行
create or replace function poll_player_by_link(p_join_token text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events;
  v_player players;
  v_rank int;
  v_team_rank int;
  v_held boolean;
begin
  v_event := _event_by('join', p_join_token);
  select * into v_player from players
  where event_id = v_event.id and code = p_code and not is_removed;
  if not found then
    perform _throttle_failed_attempt('player-code');
    raise exception 'PLAYER_NOT_FOUND:%', p_code;
  end if;
  v_held := _ranks_held(v_event);
  select count(*) + 1 into v_rank from players
  where event_id = v_event.id and not is_removed and score > v_player.score;
  select count(*) + 1 into v_team_rank from teams
  where event_id = v_event.id
    and challenge_score > coalesce((select challenge_score from teams where id = v_player.team_id), 0);

  return jsonb_build_object(
    'phase', v_event.phase,
    'started_at', v_event.started_at,
    'title', v_event.title,
    'org', (select jsonb_build_object('slug', o.slug, 'name_zh', o.name_zh, 'name_en', o.name_en)
            from organizations o where o.id = v_event.org_id),
    -- 押后期间名次根本不离开数据库。
    'rank', case when v_held then null else v_rank end,
    'team_rank', case when v_held then null else v_team_rank end,
    'ranks_published', not v_held,
    'player', _player_json(v_player),
    'team', _team_json(v_player.team_id),
    'pending_event', _pending_event_json(v_player.id),
    'attempts', coalesce((select jsonb_agg(jsonb_build_object(
      'station_id', a.station_id, 'status', a.status, 'score', a.score,
      'created_at', a.created_at) order by a.created_at)
      from attempts a where a.player_id = v_player.id
        and a.status in ('passed','failed','retry_granted')), '[]'::jsonb),
    'life_events', coalesce((select jsonb_agg(jsonb_build_object(
      'card_type', e.card_type, 'card_label', e.card_label, 'stage', e.stage,
      'scene_title', e.scene_title, 'choice_label', e.choice_label,
      'outcome_detail', e.outcome_detail,
      'score_before', e.score_before, 'score_after', e.score_after,
      'created_at', e.created_at) order by e.created_at)
      from life_events e where e.player_id = v_player.id), '[]'::jsonb),
    -- 本场启用的站点，形状与 staff_stations 一致。护照的格子照这个画。
    'stations', coalesce((select jsonb_agg(jsonb_build_object(
      'id', es.station_id, 'station_id', es.station_id, 'name_zh', es.name_zh,
      'type', es.type, 'scoring_mode', es.scoring_mode, 'sort_order', es.sort_order
      ) order by es.sort_order)
      from event_stations es
      where es.event_id = v_event.id and es.disabled_at is null), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. 控制台要知道自己该显示「公布排名」还是「已公布」
-- ---------------------------------------------------------------------------
-- 源：20260912000200_tenant_resolve.sql 第 110 行
create or replace function _session_admin_json(e events)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select _session_json(e) || jsonb_build_object(
    'staff_code', e.staff_code,
    'screen_token', e.screen_token,
    'ranks_published_at', e.ranks_published_at
  );
$$;
