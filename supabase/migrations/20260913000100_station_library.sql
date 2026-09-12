-- 阶段 2：站点库归属 + 每场启用配置。纯增量，不清空任何数据。

-- 库归属：null = 平台内置（所有机构只读可用），非 null = 该机构自建。
alter table stations add column org_id uuid references organizations (id) on delete cascade;
alter table stations drop constraint if exists stations_slug_key;
create unique index stations_org_slug_key on stations (org_id, slug) nulls not distinct;

-- 每场配置 + 快照。
create table event_stations (
  id           serial primary key,
  event_id     uuid not null references events (id) on delete cascade,
  station_id   int  not null references stations (id),
  name_zh      text not null,
  type         text not null check (type in ('main', 'life_event', 'grace')),
  scoring_mode text check (scoring_mode in ('graded', 'free', 'fixed')),
  sort_order   int  not null,
  disabled_at  timestamptz,
  created_at   timestamptz not null default now(),
  unique (event_id, station_id)
);
create index event_stations_active on event_stations (event_id, sort_order) where disabled_at is null;

alter table event_stations enable row level security;
revoke all on event_stations from anon, authenticated;
revoke all on sequence event_stations_id_seq from anon, authenticated;

-- 回填：现有场次一律启用全部内置站点，行为与阶段 1 完全一致。
insert into event_stations (event_id, station_id, name_zh, type, scoring_mode, sort_order)
select e.id, s.id, s.name_zh, s.type, s.scoring_mode, s.sort_order
from events e cross join stations s
where s.org_id is null;

-- 阶段 2 起库里会有各机构自建的站点，不能再让 anon 直读整张表。
drop policy if exists stations_public_read on stations;
revoke select on stations from anon, authenticated;

-- 能力拆进 admin_library_update 与 admin_set_event_stations（Task 3 / Task 4）。
drop function if exists admin_update_station(text, integer, text, text);
