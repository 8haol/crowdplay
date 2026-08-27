-- Life Passport V2 — team challenge score + personal journey score.
--
-- The operational unit at a station is now a team. Every member receives the
-- same station increment, while private life events may later make personal
-- journey scores diverge. Personal events are resolved on the player's phone
-- and never block the team from visiting another station.

create table teams (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,
  identity        text not null check (identity in ('solo', 'duo', 'trio')),
  color_group     text,
  challenge_score int not null default 0 check (challenge_score >= 0),
  created_at      timestamptz not null default clock_timestamp()
);

alter table players add column team_id uuid references teams (id);
create index players_team_idx on players (team_id);

create table team_attempts (
  id              bigserial primary key,
  team_id         uuid not null references teams (id),
  station_id      int not null references stations (id),
  score           int not null default 0,
  status          text not null check (status in
                    ('passed', 'failed', 'retry_granted', 'retry_used', 'superseded')),
  scored_by       text,
  idempotency_key text,
  created_at      timestamptz not null default clock_timestamp()
);

create unique index team_attempts_one_real
  on team_attempts (team_id, station_id)
  where status in ('passed', 'failed');
create unique index team_attempts_one_retry
  on team_attempts (team_id, station_id)
  where status = 'retry_granted';
create index team_attempts_team_idx on team_attempts (team_id);

create table life_event_scenes (
  key        text primary key,
  audience   text not null check (audience in ('all', 'solo', 'duo', 'trio')),
  title      text not null,
  prompt     text not null,
  emoji      text not null default '✦',
  choices    jsonb not null check (jsonb_typeof(choices) = 'array'),
  active     boolean not null default true,
  sort_order int not null default 0
);

create table life_event_instances (
  id               uuid primary key default gen_random_uuid(),
  player_id        uuid not null references players (id),
  threshold        int not null check (threshold in (15, 35, 45)),
  scene_key        text not null references life_event_scenes (key),
  scene_snapshot   jsonb not null,
  state            text not null default 'pending' check (state in ('pending', 'resolved', 'cancelled')),
  score_at_trigger int not null,
  choice_key       text,
  result_snapshot  jsonb,
  created_at       timestamptz not null default clock_timestamp(),
  resolved_at      timestamptz,
  unique (player_id, threshold)
);

create unique index life_event_instances_one_pending
  on life_event_instances (player_id) where state = 'pending';
create index life_event_instances_player_idx on life_event_instances (player_id);

alter table life_events
  add column scene_key text,
  add column scene_title text,
  add column choice_key text,
  add column choice_label text,
  add column outcome_key text,
  add column outcome_detail text;

alter table teams enable row level security;
alter table team_attempts enable row level security;
alter table life_event_scenes enable row level security;
alter table life_event_instances enable row level security;
revoke all on teams, team_attempts, life_event_scenes, life_event_instances
  from public, anon, authenticated;

-- Upgrade an already-running local event without losing it. Duo/Trio members
-- sharing a colour become one team; each legacy Solo becomes its own team.
do $$
declare
  r record;
  v_team uuid;
  v_s int := 0;
  v_d int := 0;
  v_t int := 0;
begin
  for r in
    select identity, color_group, array_agg(id order by created_at) ids,
           coalesce(max(score), 0) inferred_score
    from players
    where team_id is null and identity in ('duo', 'trio') and not is_removed
    group by identity, color_group
  loop
    if r.identity = 'duo' then
      v_d := v_d + 1;
      insert into teams (code, identity, color_group, challenge_score)
      values ('D' || lpad(v_d::text, 2, '0'), 'duo', r.color_group, r.inferred_score)
      returning id into v_team;
    else
      v_t := v_t + 1;
      insert into teams (code, identity, color_group, challenge_score)
      values ('T' || lpad(v_t::text, 2, '0'), 'trio', r.color_group, r.inferred_score)
      returning id into v_team;
    end if;
    update players set team_id = v_team where id = any(r.ids);
  end loop;

  for r in select id, color_group, score from players
           where team_id is null and identity = 'solo' and not is_removed order by created_at
  loop
    v_s := v_s + 1;
    insert into teams (code, identity, color_group, challenge_score)
    values ('S' || lpad(v_s::text, 2, '0'), 'solo', r.color_group, r.score)
    returning id into v_team;
    update players set team_id = v_team where id = r.id;
  end loop;
end $$;

-- Infer a standing team attempt for upgraded in-progress data. Existing
-- personal results remain the source of each passport's stamp history.
insert into team_attempts (team_id, station_id, score, status, scored_by, created_at)
select p.team_id, a.station_id,
       max(a.score),
       case when bool_or(a.status = 'passed') then 'passed' else 'failed' end,
       'migration', min(a.created_at)
from attempts a join players p on p.id = a.player_id
where p.team_id is not null and a.status in ('passed', 'failed')
group by p.team_id, a.station_id
on conflict do nothing;

-- -------------------------------------------------------------------------
-- Internal helpers
-- -------------------------------------------------------------------------

create or replace function _make_team(p_identity text, p_color text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_prefix text := case p_identity when 'solo' then 'S' when 'duo' then 'D' else 'T' end;
  v_slot int;
begin
  select count(*) + 1 into v_slot from teams where identity = p_identity;
  insert into teams (code, identity, color_group)
  values (v_prefix || lpad(v_slot::text, 2, '0'), p_identity, p_color)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function _player_json(p players)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'player_id', p.id,
    'name', p.name,
    'code', p.code,
    'identity', p.identity,
    'color_group', p.color_group,
    'score', p.score,
    'token_available', p.token_available,
    'locked_for_life_event', p.locked_for_life_event,
    'next_threshold', p.next_threshold,
    'pending_threshold', p.pending_threshold,
    'status_effect', p.status_effect,
    'team_id', p.team_id,
    'team_code', (select t.code from teams t where t.id = p.team_id),
    'team_challenge_score', (select t.challenge_score from teams t where t.id = p.team_id)
  );
$$;

create or replace function _team_json(p_team_id uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'team_id', t.id,
    'code', t.code,
    'identity', t.identity,
    'color_group', t.color_group,
    'challenge_score', t.challenge_score,
    'members', coalesce((select jsonb_agg(jsonb_build_object(
      'name', p.name, 'score', p.score, 'token_available', p.token_available
    ) order by p.created_at) from players p where p.team_id = t.id and not p.is_removed), '[]'::jsonb)
  )
  from teams t where t.id = p_team_id;
$$;

create or replace function _pending_event_json(p_player_id uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', i.id,
    'threshold', i.threshold,
    'title', i.scene_snapshot ->> 'title',
    'prompt', i.scene_snapshot ->> 'prompt',
    'emoji', i.scene_snapshot ->> 'emoji',
    -- Deliberately strip every hidden outcome. The browser never receives an
    -- answer table, so players cannot inspect source or network data to leak it.
    'choices', coalesce((select jsonb_agg(jsonb_build_object(
      'key', c ->> 'key', 'label', c ->> 'label'
    ) order by ord) from jsonb_array_elements(i.scene_snapshot -> 'choices')
      with ordinality as choice_rows(c, ord)), '[]'::jsonb),
    'created_at', i.created_at
  )
  from life_event_instances i
  where i.player_id = p_player_id and i.state = 'pending'
  limit 1;
$$;

create or replace function _create_event_for_player(
  p_player players,
  p_threshold int,
  p_score int
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_scene life_event_scenes;
  v_audience text;
  v_id uuid;
begin
  -- Give identity-specific stories a deliberate majority while keeping a
  -- shared pool large enough that friends cannot predict one another's scene.
  v_audience := case when random() < 0.62 then coalesce(p_player.identity, 'solo') else 'all' end;

  select * into v_scene from life_event_scenes s
  where s.active and s.audience = v_audience
    and not exists (select 1 from life_event_instances i
                    where i.player_id = p_player.id and i.scene_key = s.key)
  order by random() limit 1;

  if not found then
    select * into v_scene from life_event_scenes s
    where s.active and s.audience in ('all', coalesce(p_player.identity, 'solo'))
      and not exists (select 1 from life_event_instances i
                      where i.player_id = p_player.id and i.scene_key = s.key)
    order by random() limit 1;
  end if;
  if not found then raise exception 'NO_EVENT_SCENE'; end if;

  insert into life_event_instances (
    player_id, threshold, scene_key, scene_snapshot, score_at_trigger
  ) values (
    p_player.id, p_threshold, v_scene.key,
    jsonb_build_object('title', v_scene.title, 'prompt', v_scene.prompt,
                       'emoji', v_scene.emoji, 'choices', v_scene.choices),
    p_score
  ) returning id into v_id;
  return v_id;
end;
$$;

-- -------------------------------------------------------------------------
-- Team creation and late joining
-- -------------------------------------------------------------------------

create or replace function start_game(p_admin_key text, p_quota jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state game_state;
  v_trio_q int := greatest(coalesce((p_quota ->> 'trio')::int, 0), 0);
  v_duo_q int := greatest(coalesce((p_quota ->> 'duo')::int, 0), 0);
  v_ids uuid[];
  v_total int;
  v_pos int := 1;
  v_group int := 0;
  v_trio_made int := 0;
  v_duo_made int := 0;
  v_solo_made int := 0;
  v_palette text[] := array[
    'red','orange','yellow','green','teal','cyan','blue','indigo',
    'purple','pink','rose','lime','amber','emerald','sky','violet',
    'fuchsia','coral','gold','navy','olive','maroon','plum','mint'
  ];
  v_color text;
  v_team uuid;
begin
  perform _require_key('admin', p_admin_key);
  select * into v_state from game_state where id = 1 for update;
  if v_state.phase <> 'waiting' then raise exception 'ALREADY_STARTED'; end if;

  select coalesce(array_agg(id order by random()), '{}') into v_ids
  from players where not is_removed;
  v_total := coalesce(array_length(v_ids, 1), 0);
  if v_total = 0 then raise exception 'NO_PLAYERS'; end if;

  while v_trio_made < v_trio_q and v_pos + 2 <= v_total loop
    v_group := v_group + 1;
    v_color := v_palette[(v_group - 1) % array_length(v_palette, 1) + 1]
      || case when v_group > array_length(v_palette, 1)
              then '-' || ((v_group - 1) / array_length(v_palette, 1) + 1)::text else '' end;
    v_team := _make_team('trio', v_color);
    update players set identity = 'trio', color_group = v_color, team_id = v_team
    where id = any(v_ids[v_pos:v_pos + 2]);
    v_pos := v_pos + 3;
    v_trio_made := v_trio_made + 1;
  end loop;

  while v_duo_made < v_duo_q and v_pos + 1 <= v_total loop
    v_group := v_group + 1;
    v_color := v_palette[(v_group - 1) % array_length(v_palette, 1) + 1]
      || case when v_group > array_length(v_palette, 1)
              then '-' || ((v_group - 1) / array_length(v_palette, 1) + 1)::text else '' end;
    v_team := _make_team('duo', v_color);
    update players set identity = 'duo', color_group = v_color, team_id = v_team
    where id = any(v_ids[v_pos:v_pos + 1]);
    v_pos := v_pos + 2;
    v_duo_made := v_duo_made + 1;
  end loop;

  while v_pos <= v_total loop
    v_solo_made := v_solo_made + 1;
    v_color := 'solo-' || (((v_solo_made - 1) % 8) + 1)::text;
    v_team := _make_team('solo', v_color);
    update players set identity = 'solo', color_group = v_color, team_id = v_team
    where id = v_ids[v_pos];
    v_pos := v_pos + 1;
  end loop;

  update game_state set phase = 'playing', started_at = now() where id = 1;
  return jsonb_build_object(
    'total_players', v_total,
    'trio_groups', v_trio_made,
    'duo_groups', v_duo_made,
    'solo_players', v_solo_made,
    'total_teams', v_trio_made + v_duo_made + v_solo_made
  );
end;
$$;

create or replace function join_by_link(p_name text, p_join_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state game_state;
  v_name text := trim(coalesce(p_name, ''));
  v_code text;
  v_id uuid;
  v_team uuid;
  v_color text;
  i int;
begin
  select * into v_state from game_state where id = 1 for update;
  if p_join_token is distinct from v_state.join_token then
    if exists (select 1 from game_archives where join_token = p_join_token) then raise exception 'GAME_ARCHIVED'; end if;
    raise exception 'BAD_GAME_LINK';
  end if;
  if not v_state.join_open then raise exception 'JOIN_CLOSED'; end if;
  if v_state.phase = 'ended' then raise exception 'GAME_ARCHIVED'; end if;
  if length(v_name) < 1 or length(v_name) > 20 then raise exception 'BAD_NAME'; end if;

  for i in 1..100 loop
    v_code := lpad((floor(random() * 9999) + 1)::int::text, 4, '0');
    begin
      insert into players (name, code) values (v_name, v_code) returning id into v_id;
      exit;
    exception when unique_violation then
      v_id := null;
    end;
  end loop;
  if v_id is null then raise exception 'CODE_POOL_EXHAUSTED'; end if;

  if v_state.phase = 'playing' then
    v_color := 'solo-' || (((select count(*) from teams where identity = 'solo') % 8) + 1)::text;
    v_team := _make_team('solo', v_color);
    update players set identity = 'solo', color_group = v_color, team_id = v_team where id = v_id;
  end if;
  return jsonb_build_object('player_id', v_id, 'code', v_code,
                            'event_id', v_state.event_id, 'title', v_state.title);
end;
$$;

-- Legacy typed-passphrase entry remains available for tests and emergency
-- operation, but receives the same late-join Solo team behaviour.
create or replace function join_game(p_name text, p_passphrase text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state game_state;
  v_name text := trim(coalesce(p_name, ''));
  v_code text;
  v_id uuid;
  v_team uuid;
  v_color text;
  i int;
begin
  select * into v_state from game_state where id = 1 for update;
  if v_state.phase = 'ended' then raise exception 'GAME_ENDED'; end if;
  if not _secret_matches(v_state.join_passphrase, trim(coalesce(p_passphrase, ''))) then
    perform _throttle_failed_attempt('join-passphrase');
    raise exception 'BAD_PASSPHRASE';
  end if;
  if length(v_name) < 1 or length(v_name) > 20 then raise exception 'BAD_NAME'; end if;
  for i in 1..100 loop
    v_code := lpad((floor(random() * 9999) + 1)::int::text, 4, '0');
    begin
      insert into players (name, code) values (v_name, v_code) returning id into v_id;
      exit;
    exception when unique_violation then v_id := null;
    end;
  end loop;
  if v_id is null then raise exception 'CODE_POOL_EXHAUSTED'; end if;
  if v_state.phase = 'playing' then
    v_color := 'solo-' || (((select count(*) from teams where identity = 'solo') % 8) + 1)::text;
    v_team := _make_team('solo', v_color);
    update players set identity = 'solo', color_group = v_color, team_id = v_team where id = v_id;
  end if;
  return jsonb_build_object('player_id', v_id, 'code', v_code);
end;
$$;

-- -------------------------------------------------------------------------
-- Player polling
-- -------------------------------------------------------------------------

create or replace function poll_player(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_player players;
  v_state game_state;
  v_rank int;
  v_team_rank int;
begin
  select * into v_player from players where code = p_code and not is_removed;
  if not found then
    perform _throttle_failed_attempt('player-code');
    raise exception 'PLAYER_NOT_FOUND:%', p_code;
  end if;
  select * into v_state from game_state where id = 1;
  select count(*) + 1 into v_rank from players
    where not is_removed and score > v_player.score;
  select count(*) + 1 into v_team_rank from teams
    where challenge_score > coalesce((select challenge_score from teams where id = v_player.team_id), 0);

  return jsonb_build_object(
    'phase', v_state.phase,
    'started_at', v_state.started_at,
    'rank', v_rank,
    'team_rank', v_team_rank,
    'player', _player_json(v_player),
    'team', _team_json(v_player.team_id),
    'pending_event', _pending_event_json(v_player.id),
    'attempts', coalesce((select jsonb_agg(jsonb_build_object(
      'station_id', a.station_id, 'status', a.status, 'score', a.score,
      'created_at', a.created_at) order by a.created_at)
      from attempts a where a.player_id = v_player.id
        and a.status in ('passed','failed','retry_granted')), '[]'::jsonb),
    'life_events', coalesce((select jsonb_agg(jsonb_build_object(
      'card_type', e.card_type, 'card_label', e.card_label,
      'scene_title', e.scene_title, 'choice_label', e.choice_label,
      'outcome_detail', e.outcome_detail,
      'score_before', e.score_before, 'score_after', e.score_after,
      'created_at', e.created_at) order by e.created_at)
      from life_events e where e.player_id = v_player.id), '[]'::jsonb)
  );
end;
$$;

-- -------------------------------------------------------------------------
-- Staff: identify once, score once
-- -------------------------------------------------------------------------

create or replace function staff_lookup_team(p_staff_key text, p_identifier text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_team_id uuid;
  v_team teams;
begin
  perform _require_key('staff', p_staff_key);
  select t.id into v_team_id from teams t
  where upper(t.code) = upper(trim(coalesce(p_identifier, '')))
  limit 1;
  if v_team_id is null then
    select p.team_id into v_team_id from players p
    where p.code = trim(coalesce(p_identifier, '')) and not p.is_removed limit 1;
  end if;
  if v_team_id is null then
    return jsonb_build_object('found', false, 'identifier', trim(coalesce(p_identifier, '')));
  end if;
  select * into v_team from teams where id = v_team_id;
  return jsonb_build_object(
    'found', true,
    'phase', (select phase from game_state where id = 1),
    'team_id', v_team.id,
    'team_code', v_team.code,
    'identity', v_team.identity,
    'color_group', v_team.color_group,
    'challenge_score', v_team.challenge_score,
    'members', coalesce((select jsonb_agg(
      _player_json(p.*) || jsonb_build_object(
        'attempted_station_ids', coalesce((select jsonb_agg(a.station_id) from attempts a
          where a.player_id = p.id and a.status in ('passed','failed')), '[]'::jsonb)
      ) order by p.created_at) from players p
      where p.team_id = v_team.id and not p.is_removed), '[]'::jsonb),
    'attempted_station_ids', coalesce((select jsonb_agg(a.station_id) from team_attempts a
      where a.team_id = v_team.id and a.status in ('passed','failed')), '[]'::jsonb),
    'retry_station_ids', coalesce((select jsonb_agg(a.station_id) from team_attempts a
      where a.team_id = v_team.id and a.status = 'retry_granted'), '[]'::jsonb),
    'failed_station_ids', coalesce((select jsonb_agg(a.station_id) from team_attempts a
      where a.team_id = v_team.id and a.status = 'failed'
        and not exists (select 1 from team_attempts r where r.team_id = a.team_id
                        and r.station_id = a.station_id and r.status = 'retry_granted')), '[]'::jsonb),
    'all_tokens_available', not exists (select 1 from players p
      where p.team_id = v_team.id and not p.is_removed and not p.token_available)
  );
end;
$$;

create or replace function award_team_score(
  p_staff_key text,
  p_identifier text,
  p_station_id int,
  p_score int,
  p_failed boolean,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev jsonb;
  v_lookup jsonb;
  v_team teams;
  v_station stations;
  v_player players;
  v_award int;
  v_status text;
  v_new_score int;
  v_next int;
  v_triggered boolean;
  v_event_id uuid;
  v_retry boolean := false;
  v_members jsonb := '[]'::jsonb;
begin
  perform _require_key('staff', p_staff_key);
  if p_idempotency_key is null or p_idempotency_key = '' then raise exception 'MISSING_IDEMPOTENCY_KEY'; end if;
  select result into v_prev from rpc_results where idempotency_key = p_idempotency_key;
  if found then return v_prev; end if;
  if (select phase from game_state where id = 1) <> 'playing' then raise exception 'GAME_NOT_PLAYING'; end if;

  v_lookup := staff_lookup_team(p_staff_key, p_identifier);
  if not coalesce((v_lookup ->> 'found')::boolean, false) then raise exception 'TEAM_NOT_FOUND:%', p_identifier; end if;
  select * into v_team from teams where id = (v_lookup ->> 'team_id')::uuid for update;
  select * into v_station from stations where id = p_station_id;
  if not found or v_station.type <> 'main' then raise exception 'BAD_STATION'; end if;

  if exists (select 1 from team_attempts where team_id = v_team.id and station_id = p_station_id
             and status in ('passed','failed')) then
    if exists (select 1 from team_attempts where team_id = v_team.id and station_id = p_station_id
               and status = 'retry_granted') then
      v_retry := true;
      update team_attempts set status = 'superseded' where team_id = v_team.id
        and station_id = p_station_id and status in ('passed','failed');
      update team_attempts set status = 'retry_used' where team_id = v_team.id
        and station_id = p_station_id and status = 'retry_granted';
      update attempts set status = 'superseded' where player_id in
        (select id from players where team_id = v_team.id)
        and station_id = p_station_id and status in ('passed','failed');
    else
      raise exception 'TEAM_ALREADY_ATTEMPTED:%', v_team.code;
    end if;
  end if;

  if coalesce(p_failed, false) then
    v_award := 0; v_status := 'failed';
  else
    if v_station.scoring_mode = 'graded' and p_score not in (3,6,9) then raise exception 'BAD_TEAM_SCORE'; end if;
    if v_station.scoring_mode = 'fixed' and p_score is distinct from 6 then raise exception 'BAD_TEAM_SCORE'; end if;
    v_award := p_score; v_status := 'passed';
  end if;

  insert into team_attempts (team_id, station_id, score, status, scored_by, idempotency_key)
  values (v_team.id, p_station_id, v_award, v_status, 'staff', p_idempotency_key);
  update teams set challenge_score = challenge_score + v_award where id = v_team.id
  returning * into v_team;

  for v_player in select * from players where team_id = v_team.id and not is_removed order by id for update loop
    insert into attempts (player_id, station_id, score, status, scored_by, idempotency_key)
    values (v_player.id, p_station_id, v_award, v_status, 'team:' || v_team.code,
            p_idempotency_key || ':' || v_player.code);
    v_new_score := v_player.score + v_award;
    v_next := v_player.next_threshold;
    v_triggered := false;
    v_event_id := null;
    if not v_player.locked_for_life_event and v_next is not null and v_new_score >= v_next then
      v_triggered := true;
      v_event_id := _create_event_for_player(v_player, v_next, v_new_score);
    end if;
    update players set
      score = v_new_score,
      locked_for_life_event = locked_for_life_event or v_triggered,
      pending_threshold = case when v_triggered then v_next else pending_threshold end,
      next_threshold = case when v_triggered then _advance_threshold(v_new_score, v_next) else v_next end
    where id = v_player.id;
    v_members := v_members || jsonb_build_object(
      'code', v_player.code, 'name', v_player.name, 'awarded', v_award,
      'new_score', v_new_score, 'life_event_triggered', v_triggered,
      'threshold', case when v_triggered then v_next end,
      'event_id', v_event_id
    );
  end loop;

  v_prev := jsonb_build_object(
    'team_code', v_team.code, 'identity', v_team.identity,
    'status', v_status, 'awarded', v_award, 'retry_used', v_retry,
    'challenge_score', v_team.challenge_score, 'members', v_members
  );
  insert into rpc_results (idempotency_key, result) values (p_idempotency_key, v_prev);
  return v_prev;
end;
$$;

-- -------------------------------------------------------------------------
-- Player-side hidden random outcome
-- -------------------------------------------------------------------------

create or replace function choose_life_event_by_link(
  p_join_token text,
  p_player_code text,
  p_event_id uuid,
  p_choice_key text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state game_state;
  v_player players;
  v_instance life_event_instances;
  v_choice jsonb;
  v_outcome jsonb;
  v_candidate jsonb;
  v_total int := 0;
  v_roll int;
  v_cursor int := 0;
  v_before int;
  v_after int;
  v_delta int;
  v_multiplier int;
  v_next int;
  v_result jsonb;
begin
  select * into v_state from game_state where id = 1;
  if p_join_token is distinct from v_state.join_token then raise exception 'BAD_GAME_LINK'; end if;
  if v_state.phase <> 'playing' then raise exception 'GAME_NOT_PLAYING'; end if;
  select * into v_player from players where code = p_player_code and not is_removed for update;
  if not found then raise exception 'PLAYER_NOT_FOUND:%', p_player_code; end if;
  select * into v_instance from life_event_instances
    where id = p_event_id and player_id = v_player.id for update;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  if v_instance.state = 'resolved' then return v_instance.result_snapshot; end if;
  if v_instance.state <> 'pending' then raise exception 'EVENT_NOT_PENDING'; end if;

  select c into v_choice from jsonb_array_elements(v_instance.scene_snapshot -> 'choices') c
  where c ->> 'key' = p_choice_key limit 1;
  if v_choice is null then raise exception 'BAD_EVENT_CHOICE'; end if;
  select coalesce(sum((o ->> 'weight')::int), 0) into v_total
    from jsonb_array_elements(v_choice -> 'outcomes') o;
  if v_total <= 0 then raise exception 'BAD_EVENT_OUTCOMES'; end if;
  v_roll := floor(random() * v_total)::int + 1;
  for v_candidate in select * from jsonb_array_elements(v_choice -> 'outcomes') loop
    v_cursor := v_cursor + (v_candidate ->> 'weight')::int;
    if v_roll <= v_cursor then v_outcome := v_candidate; exit; end if;
  end loop;

  v_before := v_player.score;
  v_delta := coalesce((v_outcome ->> 'delta')::int, 0);
  v_multiplier := coalesce((v_outcome ->> 'multiplier')::int, 100);
  v_after := greatest(0, floor(v_before * v_multiplier / 100.0)::int + v_delta);
  v_next := _advance_threshold(v_after, v_player.next_threshold);

  insert into life_events (
    player_id, threshold, card_type, card_label, score_before, score_after,
    scene_key, scene_title, choice_key, choice_label, outcome_key, outcome_detail
  ) values (
    v_player.id, v_instance.threshold,
    'choice_' || v_instance.scene_key,
    v_outcome ->> 'label', v_before, v_after,
    v_instance.scene_key, v_instance.scene_snapshot ->> 'title',
    p_choice_key, v_choice ->> 'label', v_outcome ->> 'key', v_outcome ->> 'detail'
  );

  update players set score = v_after, locked_for_life_event = false,
    pending_threshold = null, next_threshold = v_next where id = v_player.id;
  v_result := jsonb_build_object(
    'event_id', v_instance.id,
    'scene_title', v_instance.scene_snapshot ->> 'title',
    'choice_label', v_choice ->> 'label',
    'outcome_key', v_outcome ->> 'key',
    'outcome_label', v_outcome ->> 'label',
    'outcome_detail', v_outcome ->> 'detail',
    'tone', coalesce(v_outcome ->> 'tone', 'neutral'),
    'score_before', v_before, 'score_after', v_after,
    'delta', v_after - v_before, 'next_threshold', v_next
  );
  update life_event_instances set state = 'resolved', choice_key = p_choice_key,
    result_snapshot = v_result, resolved_at = clock_timestamp() where id = v_instance.id;
  if p_idempotency_key is not null and p_idempotency_key <> '' then
    insert into rpc_results (idempotency_key, result) values (p_idempotency_key, v_result)
    on conflict (idempotency_key) do nothing;
  end if;
  return v_result;
end;
$$;

-- -------------------------------------------------------------------------
-- Token balance: team-impacting help costs every member; souvenir redemption
-- is personal and only available after the event has ended.
-- -------------------------------------------------------------------------

create or replace function use_team_token(
  p_staff_key text,
  p_identifier text,
  p_usage_type text,
  p_station_id int default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev jsonb;
  v_lookup jsonb;
  v_team teams;
  v_player players;
  v_members jsonb := '[]'::jsonb;
begin
  perform _require_key('staff', p_staff_key);
  if p_idempotency_key is not null then
    select result into v_prev from rpc_results where idempotency_key = p_idempotency_key;
    if found then return v_prev; end if;
  end if;
  if (select phase from game_state where id = 1) <> 'playing' then raise exception 'GAME_NOT_PLAYING'; end if;
  if p_usage_type not in ('hint','second_chance') then raise exception 'BAD_USAGE_TYPE'; end if;
  v_lookup := staff_lookup_team(p_staff_key, p_identifier);
  if not coalesce((v_lookup ->> 'found')::boolean, false) then raise exception 'TEAM_NOT_FOUND:%', p_identifier; end if;
  select * into v_team from teams where id = (v_lookup ->> 'team_id')::uuid for update;
  if exists (select 1 from players where team_id = v_team.id and not is_removed and not token_available) then
    raise exception 'TEAM_TOKEN_INCOMPLETE:%', v_team.code;
  end if;
  if p_usage_type = 'second_chance' then
    if p_station_id is null then raise exception 'STATION_REQUIRED'; end if;
    if not exists (select 1 from team_attempts where team_id = v_team.id
      and station_id = p_station_id and status = 'failed') then raise exception 'TEAM_NOT_FAILED:%', v_team.code; end if;
    if exists (select 1 from team_attempts where team_id = v_team.id
      and station_id = p_station_id and status = 'retry_granted') then raise exception 'RETRY_ALREADY_GRANTED:%', v_team.code; end if;
    insert into team_attempts (team_id, station_id, status, scored_by)
    values (v_team.id, p_station_id, 'retry_granted', 'token');
  end if;
  for v_player in select * from players where team_id = v_team.id and not is_removed order by id for update loop
    update players set token_available = false where id = v_player.id;
    insert into token_usages (player_id, usage_type, target_station_id)
    values (v_player.id, p_usage_type, case when p_usage_type = 'second_chance' then p_station_id end);
    v_members := v_members || jsonb_build_object('code', v_player.code, 'name', v_player.name);
  end loop;
  v_prev := jsonb_build_object('team_code', v_team.code, 'usage_type', p_usage_type,
    'target_station_id', p_station_id, 'members', v_members);
  if p_idempotency_key is not null then
    insert into rpc_results (idempotency_key, result) values (p_idempotency_key, v_prev);
  end if;
  return v_prev;
end;
$$;

create or replace function redeem_token_card(
  p_staff_key text,
  p_player_code text,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_player players;
  v_result jsonb;
begin
  perform _require_key('staff', p_staff_key);
  if (select phase from game_state where id = 1) <> 'ended' then raise exception 'CARD_REDEMPTION_NOT_OPEN'; end if;
  select * into v_player from players where code = p_player_code and not is_removed for update;
  if not found then raise exception 'PLAYER_NOT_FOUND:%', p_player_code; end if;
  if not v_player.token_available then raise exception 'NO_TOKEN:%', p_player_code; end if;
  update players set token_available = false where id = v_player.id;
  insert into token_usages (player_id, usage_type) values (v_player.id, 'grace_card');
  v_result := jsonb_build_object('code', v_player.code, 'name', v_player.name,
                                 'usage_type', 'grace_card');
  if p_idempotency_key is not null then
    insert into rpc_results (idempotency_key, result) values (p_idempotency_key, v_result)
    on conflict (idempotency_key) do nothing;
  end if;
  return v_result;
end;
$$;

revoke execute on function _make_team(text, text), _team_json(uuid),
  _pending_event_json(uuid), _create_event_for_player(players, int, int)
  from public, anon, authenticated;

grant execute on function
  staff_lookup_team(text, text),
  award_team_score(text, text, int, int, boolean, text),
  choose_life_event_by_link(text, text, uuid, text, text),
  use_team_token(text, text, text, int, text),
  redeem_token_card(text, text, text)
to anon, authenticated;

