-- Tests: board_snapshot — payload shape, privacy (no codes), feed contents
begin;
delete from rpc_results; delete from admin_actions; delete from token_usages;
delete from life_events; delete from attempts; delete from players;
update app_config set value = 'test-admin' where key = 'admin_key';
update app_config set value = 'test-staff' where key = 'staff_key';
update game_state set phase = 'playing', join_passphrase = 'pass', started_at = now() where id = 1;

do $$
declare
  v_music int := (select id from stations where slug = 'music');
  v_uk    int := (select id from stations where slug = 'uk-life');
  r jsonb;
  v_feed jsonb;
begin
  insert into players (name, code, identity, color_group) values
    ('甲', '7001', 'trio', 'red'),
    ('乙', '7002', 'trio', 'red'),
    ('丙', '7003', 'solo', null),
    ('垃圾', '7004', 'solo', null);
  perform admin_remove_player('test-admin', '7004');

  -- empty game still returns a well-formed payload
  r := board_snapshot();
  assert r ->> 'phase' = 'playing', 'phase present';
  assert jsonb_array_length(r -> 'players') = 3, 'removed player excluded';
  assert jsonb_array_length(r -> 'feed') = 0, 'feed empty before any action';
  assert (r -> 'stats' ->> 'players')::int = 3, 'stats count excludes removed';

  -- PRIVACY: no player object carries a code field. Do not search the raw JSON
  -- text for four digits: a random UUID can legitimately contain that sequence.
  assert not exists (
    select 1 from jsonb_array_elements(r -> 'players') p where p ? 'code'
  ), 'players carry no code field';
  assert not exists (
    select 1 from jsonb_array_elements(r -> 'players') p where p ->> 'name' = '垃圾'
  ), 'removed player is absent from the board';

  -- generate activity
  perform award_scores('test-staff',
    '[{"code":"7001","score":9},{"code":"7002","score":3},{"code":"7003","failed":true}]'::jsonb,
    v_music, 'b1');
  perform award_scores('test-staff', '[{"code":"7001","score":9}]'::jsonb, v_uk, 'b2');
  perform apply_life_event('test-staff', '7001', 'fortune_plus3', 'b3');
  perform use_token('test-staff', '7003', 'second_chance', v_music, 'b4');

  r := board_snapshot();
  v_feed := r -> 'feed';

  -- ranking: 甲 leads (9+9+3 = 21)
  assert r -> 'players' -> 0 ->> 'name' = '甲', 'players sorted by score desc';
  assert (r -> 'players' -> 0 ->> 'score')::int = 21, 'score after card';
  assert (r -> 'players' -> 0 ->> 'stations_done')::int = 2, 'stations_done counted';
  assert (r -> 'players' -> 0 ->> 'id') is not null, 'stable id present for keys';

  -- feed has every kind, newest first
  assert jsonb_array_length(v_feed) = 6,
         'feed = 3 attempts + 1 retry-station attempt? no: 4 attempts total? got ' ||
         jsonb_array_length(v_feed)::text;
  assert v_feed -> 0 ->> 'kind' = 'token', 'newest event first (token was last)';
  assert exists (select 1 from jsonb_array_elements(v_feed) f
                 where f ->> 'kind' = 'life_event' and f ->> 'name' = '甲'
                   and (f ->> 'after')::int = 21), 'life_event in feed with new score';
  assert exists (select 1 from jsonb_array_elements(v_feed) f
                 where f ->> 'kind' = 'attempt' and (f ->> 'score')::int = 9
                   and f ->> 'station' = '音乐之声'), 'perfect score in feed';
  assert exists (select 1 from jsonb_array_elements(v_feed) f
                 where f ->> 'kind' = 'attempt' and f ->> 'status' = 'failed'
                   and f ->> 'name' = '丙'), 'failure in feed';
  assert exists (select 1 from jsonb_array_elements(v_feed) f
                 where f ->> 'kind' = 'token' and f ->> 'usage' = 'second_chance'
                   and f ->> 'station' = '音乐之声'), 'token use in feed with station';
  assert not exists (
    select 1 from jsonb_array_elements(v_feed) f where f ? 'code'
  ), 'feed carries no code field';

  -- a locked player is flagged so the board can call it out
  perform award_scores('test-staff', '[{"code":"7002","score":9}]'::jsonb, v_uk, 'b5');
  perform award_scores('test-staff',
    '[{"code":"7002","score":9}]'::jsonb,
    (select id from stations where slug = 'interview'), 'b6');
  r := board_snapshot();
  assert exists (select 1 from jsonb_array_elements(r -> 'players') p
                 where p ->> 'name' = '乙' and (p ->> 'locked')::boolean),
         'locked flag exposed to the board';

  -- sick flag
  perform apply_life_event('test-staff', '7002', 'bad_cap_next', 'b7');
  r := board_snapshot();
  assert exists (select 1 from jsonb_array_elements(r -> 'players') p
                 where p ->> 'name' = '乙' and (p ->> 'sick')::boolean),
         'cap_next surfaces as sick';

  -- anon can call it (it is the projector page, no auth)
  set local role anon;
  r := board_snapshot();
  assert jsonb_array_length(r -> 'players') = 3, 'anon may read the board';
  reset role;

  raise notice 'PASS 08_board';
end $$;
rollback;
