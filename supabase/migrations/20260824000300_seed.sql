-- Life Passport — seed data.
-- IMPORTANT: change the three placeholder secrets before the event
-- (see README "活动日 checklist"). They can be updated any time with plain
-- UPDATEs from the Supabase SQL editor.

insert into app_config (key, value) values
  ('admin_key', 'change-me-admin'),
  ('staff_key', 'change-me-staff');

insert into game_state (id, phase, join_passphrase)
values (1, 'waiting', 'change-me');

insert into stations (slug, name_zh, type, scoring_mode, sort_order) values
  ('music',      '音乐之声',   'main',       'graded', 1),
  ('uk-life',    '英伦百事通', 'main',       'graded', 2),
  ('interview',  '灵魂拷问',   'main',       'graded', 3),
  ('photo',      '定格瞬间',   'main',       'graded', 4),
  ('memory',     '记忆与观察', 'main',       'graded', 5),
  ('ring-toss',  '套圈',       'main',       'graded', 6),
  ('library',    '寂静图书馆', 'main',       'graded', 7),
  ('life-event', '人生盲盒',   'life_event', null,     8),
  ('grace',      '恩典站',     'grace',      null,     9);
