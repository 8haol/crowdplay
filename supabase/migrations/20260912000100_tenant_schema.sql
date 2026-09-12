-- Life Passport · 多租户阶段 1 · 表结构
--
-- 「一个单行 game_state + 两个全局密码」→「organizations → events → 一切游戏数据」。
-- 现有数据全部是测试数据（业主确认），所以这里直接 truncate，而不是写回填：
-- 这让 `add column event_id not null` 可以一步到位。
--
-- 见 docs/superpowers/specs/2026-09-11-multi-tenant-phase1-design.md

-- ---------------------------------------------------------------------------
-- 0. 清空游戏数据（子表先删）
-- ---------------------------------------------------------------------------
truncate table rpc_results, admin_actions, token_usages, life_events,
  life_event_instances, attempts, team_attempts, players, teams;

-- ---------------------------------------------------------------------------
-- 1. 令牌生成器（种子和 admin_create_event 共用）
-- ---------------------------------------------------------------------------

-- 16 位十六进制：入场链接、大屏链接。不可猜，URL 安全。
create or replace function _gen_hex_token()
returns text
language sql
volatile
set search_path = public, pg_temp
as $$
  select encode(extensions.gen_random_bytes(8), 'hex');
$$;

-- 6 位工作人员码。字母表去掉 0/O/1/I 这类会在口头传达时混淆的字符；
-- 志愿者是在嘈杂的场地里对着微信语音敲的。
create or replace function _gen_staff_code()
returns text
language sql
volatile
set search_path = public, pg_temp
as $$
  select string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), ''
  ) from generate_series(1, 6);
$$;

-- ---------------------------------------------------------------------------
-- 2. 机构与场次
-- ---------------------------------------------------------------------------
create table organizations (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,30}$'),
  name_zh     text not null check (length(name_zh) between 1 and 40),
  name_en     text not null check (length(name_en) between 1 and 60),
  -- '{sha256}<hex>'。阶段 3 用 Supabase Auth + org_members 取代。
  admin_key   text not null,
  created_at  timestamptz not null default now()
);
comment on table organizations is '一个教会 / 主办方。阶段 1 由 SQL 种子创建，阶段 4 才有界面。';

create table events (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  title         text not null check (length(title) between 1 and 60),
  phase         text not null default 'waiting' check (phase in ('waiting', 'playing', 'ended')),
  -- 三把钥匙，各对应一类使用者。拿到哪一把，就只能做那一类事，且只在这一场。
  join_token    text not null unique,   -- 玩家：二维码 / 入场链接
  staff_code    text not null unique,   -- 工作人员：6 位大写，明文（见 spec）
  screen_token  text not null unique,   -- 大屏：投影链接
  join_open     boolean not null default true,
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  ended_at      timestamptz
);
create index events_org_created_idx on events (org_id, created_at desc);
comment on table events is '一场活动。结束的场次留在这里带着全部关系数据，不再做快照归档。';

-- 表本身不对 anon 开放；所有访问经由 SECURITY DEFINER 的 RPC。
alter table organizations enable row level security;
alter table events enable row level security;

-- ---------------------------------------------------------------------------
-- 3. 子表挂上 event_id
-- ---------------------------------------------------------------------------
alter table players              add column event_id uuid not null references events(id) on delete cascade;
alter table teams                add column event_id uuid not null references events(id) on delete cascade;
alter table attempts             add column event_id uuid not null references events(id) on delete cascade;
alter table team_attempts        add column event_id uuid not null references events(id) on delete cascade;
alter table life_events          add column event_id uuid not null references events(id) on delete cascade;
alter table life_event_instances add column event_id uuid not null references events(id) on delete cascade;
alter table token_usages         add column event_id uuid not null references events(id) on delete cascade;
alter table admin_actions        add column event_id uuid not null references events(id) on delete cascade;
alter table rpc_results          add column event_id uuid not null references events(id) on delete cascade;

create index players_event_idx              on players (event_id);
create index teams_event_idx                on teams (event_id);
create index attempts_event_idx             on attempts (event_id);
create index team_attempts_event_idx        on team_attempts (event_id);
create index life_events_event_idx          on life_events (event_id);
create index life_event_instances_event_idx on life_event_instances (event_id);
create index token_usages_event_idx         on token_usages (event_id);
create index admin_actions_event_idx        on admin_actions (event_id);
create index rpc_results_event_idx          on rpc_results (event_id);

-- 编号和队伍码只需在场内唯一。工作人员已绑定场次，跨场撞号不再是问题。
alter table players drop constraint players_code_key;
alter table players add constraint players_event_code_key unique (event_id, code);
alter table teams   drop constraint teams_code_key;
alter table teams   add constraint teams_event_code_key unique (event_id, code);

-- ---------------------------------------------------------------------------
-- 4. 种子：格拉斯哥 = 机构 #1，沿用原管理密码；开一场等待中的活动
-- ---------------------------------------------------------------------------
insert into organizations (slug, name_zh, name_en, admin_key)
select 'gcgc', '格拉斯哥华人福音教会', 'Glasgow Chinese Gospel Church', value
from app_config where key = 'admin_key';

insert into events (org_id, title, join_token, staff_code, screen_token)
select id, 'Life Passport 迎新会', _gen_hex_token(), _gen_staff_code(), _gen_hex_token()
from organizations where slug = 'gcgc';

-- ---------------------------------------------------------------------------
-- 5. 拆掉单行时代的东西
-- ---------------------------------------------------------------------------
-- _session_json 的参数类型是 game_state，必须先删函数才能删表；下一份迁移重建为 events 版。
drop function if exists _session_json(game_state);
drop trigger if exists game_archives_personal_top on game_archives;
drop function if exists _archive_set_personal_top();
drop table game_archives;
drop table game_state;
drop table app_config;

-- 遗留入口：口令入场、个人计分、个人 Token、实体盲盒卡。前端早已不调用，
-- 它们读的 game_state 也已经不存在。
drop function if exists join_game(text, text);
drop function if exists poll_player(text);
drop function if exists recover_identity(text);
drop function if exists award_scores(text, jsonb, integer, text);
drop function if exists use_token(text, text, text, integer, text);
drop function if exists apply_life_event(text, text, text, text);
drop function if exists _require_key(text, text);
