-- Life Passport — schema
-- All game logic lives in security-definer RPCs (see 20260824000200_functions.sql).
-- Anon key can only: call whitelisted RPCs, read stations + two public views.

-- ---------------------------------------------------------------------------
-- Private config: staff/admin shared keys. No RLS policy => invisible to anon.
-- ---------------------------------------------------------------------------
create table app_config (
  key   text primary key,
  value text not null
);

-- ---------------------------------------------------------------------------
-- Global game state (single row, id = 1)
-- ---------------------------------------------------------------------------
create table game_state (
  id              int primary key check (id = 1),
  phase           text not null default 'waiting'
                  check (phase in ('waiting', 'playing', 'ended')),
  join_passphrase text not null,
  started_at      timestamptz
);

-- ---------------------------------------------------------------------------
-- Stations (seeded)
-- ---------------------------------------------------------------------------
create table stations (
  id           serial primary key,
  slug         text not null unique,
  name_zh      text not null,
  type         text not null check (type in ('main', 'life_event', 'grace')),
  -- graded = staff picks 3/6/9; fixed = completing awards exactly 6
  scoring_mode text check (scoring_mode in ('graded', 'fixed')),
  sort_order   int not null default 0
);

-- ---------------------------------------------------------------------------
-- Players
-- ---------------------------------------------------------------------------
create table players (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  code                   char(4) not null unique,
  identity               text check (identity in ('solo', 'duo', 'trio')),
  color_group            text,
  score                  int not null default 0,
  token_available        boolean not null default true,
  locked_for_life_event  boolean not null default false,
  -- 15 -> 35 -> 45 -> null; never moves backwards
  next_threshold         int default 15,
  -- the threshold that caused the current lock (set on lock, cleared on unlock)
  pending_threshold      int,
  -- e.g. {"type":"cap_next","value":1}
  status_effect          jsonb,
  is_removed             boolean not null default false,
  created_at             timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Attempts
-- Statuses:
--   passed / failed  = the player's one real attempt at a station
--   retry_granted    = a pending Second Chance (from a token)
--   retry_used       = that Second Chance was consumed
--   superseded       = a failed attempt replaced by a retry result
-- NOTE (deviation from spec): the spec's partial unique index
--   unique(player_id, station_id) where status != 'retry_granted'
-- would block inserting the retry result while the old failed row exists,
-- so the "one real attempt" index only covers passed/failed and the old
-- failed row is flipped to 'superseded' when a retry is consumed.
-- ---------------------------------------------------------------------------
create table attempts (
  id              bigserial primary key,
  player_id       uuid not null references players (id),
  station_id      int not null references stations (id),
  score           int not null default 0,
  status          text not null check (status in
                    ('passed', 'failed', 'retry_granted', 'retry_used', 'superseded')),
  scored_by       text,
  idempotency_key text,
  created_at      timestamptz not null default now()
);

create unique index attempts_one_real_attempt
  on attempts (player_id, station_id)
  where status in ('passed', 'failed');

create unique index attempts_one_pending_retry
  on attempts (player_id, station_id)
  where status = 'retry_granted';

create index attempts_player_idx on attempts (player_id);

-- ---------------------------------------------------------------------------
-- Life events (blind-box cards)
-- ---------------------------------------------------------------------------
create table life_events (
  id           bigserial primary key,
  player_id    uuid not null references players (id),
  threshold    int,
  card_type    text not null,
  card_label   text not null,
  score_before int not null,
  score_after  int not null,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Token usages
-- ---------------------------------------------------------------------------
create table token_usages (
  id                bigserial primary key,
  player_id         uuid not null references players (id),
  usage_type        text not null check (usage_type in ('hint', 'second_chance', 'grace_card')),
  target_station_id int references stations (id),
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Admin audit log
-- ---------------------------------------------------------------------------
create table admin_actions (
  id         bigserial primary key,
  player_id  uuid references players (id),
  action     text not null,
  detail     jsonb,
  reason     text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Idempotency: stored results of completed write RPCs.
-- A retried request with the same key returns the stored result verbatim
-- and performs no writes.
-- ---------------------------------------------------------------------------
create table rpc_results (
  idempotency_key text primary key,
  result          jsonb not null,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Public read surfaces (security-definer views owned by postgres)
-- ---------------------------------------------------------------------------
-- game_state without the passphrase
create view public_game_state as
  select phase, started_at from game_state where id = 1;

create view leaderboard as
  select name, code, identity, score
  from players
  where not is_removed
  order by score desc, created_at asc;

-- ---------------------------------------------------------------------------
-- RLS: enabled everywhere, no policies => tables unreachable with anon key.
-- Reads happen through the views above; writes through security-definer RPCs.
-- ---------------------------------------------------------------------------
alter table app_config   enable row level security;
alter table game_state   enable row level security;
alter table stations     enable row level security;
alter table players      enable row level security;
alter table attempts     enable row level security;
alter table life_events  enable row level security;
alter table token_usages enable row level security;
alter table admin_actions enable row level security;
alter table rpc_results  enable row level security;

-- stations are harmless public config: allow direct select
create policy stations_public_read on stations for select using (true);

revoke all on all tables in schema public from anon, authenticated;
grant select on stations, public_game_state, leaderboard to anon, authenticated;
