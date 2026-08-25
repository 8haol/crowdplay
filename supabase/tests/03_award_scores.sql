-- Tests: award_scores — batch, all-or-nothing rollback, thresholds,
-- cap_next, fixed scoring, idempotency, retry consumption, _advance_threshold
begin;
delete from rpc_results; delete from admin_actions; delete from token_usages;
delete from life_events; delete from attempts; delete from players;
update app_config set value = 'test-admin' where key = 'admin_key';
update app_config set value = 'test-staff' where key = 'staff_key';
update game_state set phase = 'playing', join_passphrase = 'pass', started_at = now() where id = 1;
-- make one station fixed-mode for this test run
update stations set scoring_mode = 'fixed' where slug = 'ring-toss';

do $$
declare
  v_music   int := (select id from stations where slug = 'music');
  v_uk      int := (select id from stations where slug = 'uk-life');
  v_intv    int := (select id from stations where slug = 'interview');
  v_photo   int := (select id from stations where slug = 'photo');
  v_memory  int := (select id from stations where slug = 'memory');
  v_ring    int := (select id from stations where slug = 'ring-toss');
  v_grace   int := (select id from stations where slug = 'grace');
  r jsonb;
begin
  insert into players (name, code, identity) values
    ('甲', '1001', 'solo'), ('乙', '1002', 'solo'), ('丙', '1003', 'solo'),
    ('丁', '1004', 'solo');

  -- === threshold helper sanity (incl. double-cross + null propagation) ===
  assert _advance_threshold(21, 15) = 35,  'crossed 15 -> next 35';
  assert _advance_threshold(43, 35) = 45,  'crossed 35 -> next 45';
  assert _advance_threshold(50, 35) is null, 'double-cross 35+45 -> null';
  assert _advance_threshold(50, 45) is null, 'past 45 -> null';
  assert _advance_threshold(99, null) is null, 'null stays null';
  assert _advance_threshold(10, 35) = 35,  'score below current keeps current';

  -- === bad staff key ===
  begin
    perform award_scores('nope', '[{"code":"1001","score":6}]'::jsonb, v_music, 'k0');
    raise exception 'TEST FAILED: expected BAD_KEY';
  exception when others then
    if sqlerrm <> 'BAD_KEY' then raise; end if;
  end;

  -- === admin key is accepted where staff key is ===
  r := award_scores('test-admin', '[{"code":"1004","score":3}]'::jsonb, v_photo, 'k-admin');
  assert (r -> 'results' -> 0 ->> 'new_score')::int = 3, 'admin key works for scoring';

  -- === basic single graded award ===
  r := award_scores('test-staff', '[{"code":"1001","score":6}]'::jsonb, v_music, 'k1');
  assert (r -> 'results' -> 0 ->> 'new_score')::int = 6, 'score 6 recorded';
  assert (r -> 'results' -> 0 ->> 'life_event_triggered')::boolean = false, 'no lock yet';
  assert (select score from players where code = '1001') = 6, 'player score updated';
  assert (select status from attempts a join players p on p.id = a.player_id
          where p.code = '1001' and a.station_id = v_music) = 'passed', 'attempt row';

  -- === graded station rejects non-3/6/9 ===
  begin
    perform award_scores('test-staff', '[{"code":"1001","score":5}]'::jsonb, v_uk, 'k2');
    raise exception 'TEST FAILED: expected BAD_SCORE';
  exception when others then
    if sqlerrm <> 'BAD_SCORE:1001' then raise; end if;
  end;

  -- === fixed station: only 6 allowed ===
  begin
    perform award_scores('test-staff', '[{"code":"1001","score":9}]'::jsonb, v_ring, 'k3');
    raise exception 'TEST FAILED: expected BAD_SCORE';
  exception when others then
    if sqlerrm <> 'BAD_SCORE:1001' then raise; end if;
  end;
  r := award_scores('test-staff', '[{"code":"1001","score":6}]'::jsonb, v_ring, 'k4');
  assert (select score from players where code = '1001') = 12, 'fixed station adds 6';

  -- === non-main station rejected ===
  begin
    perform award_scores('test-staff', '[{"code":"1001","score":6}]'::jsonb, v_grace, 'k5');
    raise exception 'TEST FAILED: expected BAD_STATION';
  exception when others then
    if sqlerrm <> 'BAD_STATION' then raise; end if;
  end;

  -- === same station twice rejected ===
  begin
    perform award_scores('test-staff', '[{"code":"1001","score":3}]'::jsonb, v_music, 'k6');
    raise exception 'TEST FAILED: expected ALREADY_ATTEMPTED';
  exception when others then
    if sqlerrm <> 'ALREADY_ATTEMPTED:1001' then raise; end if;
  end;

  -- === idempotency: same key returns stored result, no double-scoring ===
  r := award_scores('test-staff', '[{"code":"1001","score":6}]'::jsonb, v_music, 'k1');
  assert (r -> 'results' -> 0 ->> 'new_score')::int = 6, 'replay returns original result';
  assert (select score from players where code = '1001') = 12, 'replay does not re-score';

  -- === batch of 3 in one call ===
  r := award_scores('test-staff',
        '[{"code":"1001","score":3},{"code":"1002","score":9},{"code":"1003","failed":true}]'::jsonb,
        v_uk, 'k7');
  assert jsonb_array_length(r -> 'results') = 3, '3 results';
  assert (select score from players where code = '1001') = 15, 'batch member 1';
  assert (select score from players where code = '1002') = 9,  'batch member 2';
  assert (select score from players where code = '1003') = 0,  'failed member scores 0';
  assert (select status from attempts a join players p on p.id = a.player_id
          where p.code = '1003' and a.station_id = v_uk) = 'failed', 'failed attempt row';
  -- 1001 hit 15 exactly => locked
  assert (select locked_for_life_event from players where code = '1001'), '1001 locked at 15';
  assert (select pending_threshold from players where code = '1001') = 15, 'pending recorded';
  assert (select next_threshold from players where code = '1001') = 35, 'next advanced to 35';
  assert (r -> 'results' -> 0 ->> 'life_event_triggered')::boolean, 'lock reported to staff';

  -- === locked player cannot be scored ===
  begin
    perform award_scores('test-staff', '[{"code":"1001","score":3}]'::jsonb, v_intv, 'k8');
    raise exception 'TEST FAILED: expected LOCKED_LIFE_EVENT';
  exception when others then
    if sqlerrm <> 'LOCKED_LIFE_EVENT:1001' then raise; end if;
  end;

  -- === all-or-nothing: one bad member rolls back the whole batch ===
  begin
    perform award_scores('test-staff',
      '[{"code":"1002","score":6},{"code":"1001","score":6}]'::jsonb, v_intv, 'k9');
    raise exception 'TEST FAILED: expected LOCKED_LIFE_EVENT for batch';
  exception when others then
    if sqlerrm <> 'LOCKED_LIFE_EVENT:1001' then raise; end if;
  end;
  assert (select score from players where code = '1002') = 9,
         'valid member of failed batch was rolled back';
  assert not exists (select 1 from attempts a join players p on p.id = a.player_id
                     where p.code = '1002' and a.station_id = v_intv),
         'no attempt row left behind by rolled-back batch';

  -- === duplicate codes in one batch rejected ===
  begin
    perform award_scores('test-staff',
      '[{"code":"1002","score":6},{"code":"1002","score":6}]'::jsonb, v_intv, 'k10');
    raise exception 'TEST FAILED: expected DUPLICATE_CODES';
  exception when others then
    if sqlerrm <> 'DUPLICATE_CODES' then raise; end if;
  end;

  -- === unknown player ===
  begin
    perform award_scores('test-staff', '[{"code":"9999","score":6}]'::jsonb, v_intv, 'k11');
    raise exception 'TEST FAILED: expected PLAYER_NOT_FOUND';
  exception when others then
    if sqlerrm <> 'PLAYER_NOT_FOUND:9999' then raise; end if;
  end;

  -- === cap_next: score capped to 1, effect cleared, fail does NOT consume ===
  update players set status_effect = '{"type":"cap_next","value":1}'::jsonb
  where code = '1002';
  -- a failure first: effect must survive (spec: failure short-circuits)
  r := award_scores('test-staff', '[{"code":"1002","failed":true}]'::jsonb, v_photo, 'k12');
  assert (select status_effect from players where code = '1002') is not null,
         'failure does not consume cap_next';
  -- then a pass: 9 capped to 1
  r := award_scores('test-staff', '[{"code":"1002","score":9}]'::jsonb, v_intv, 'k13');
  assert (r -> 'results' -> 0 ->> 'awarded')::int = 1, 'award capped to 1';
  assert (r -> 'results' -> 0 ->> 'cap_applied')::boolean, 'cap flagged in result';
  assert (select score from players where code = '1002') = 10, '9 + 1 = 10';
  assert (select status_effect from players where code = '1002') is null,
         'cap_next cleared after use';

  -- === Second Chance consumption: failed -> retry_granted -> pass ===
  perform use_token('test-staff', '1002', 'second_chance', v_photo, 'k14');
  r := award_scores('test-staff', '[{"code":"1002","score":6}]'::jsonb, v_photo, 'k15');
  assert (select score from players where code = '1002') = 16, 'retry pass adds 6';
  assert (select count(*) from attempts a join players p on p.id = a.player_id
          where p.code = '1002' and a.station_id = v_photo and a.status = 'superseded') = 1,
         'old failed attempt superseded';
  assert (select count(*) from attempts a join players p on p.id = a.player_id
          where p.code = '1002' and a.station_id = v_photo and a.status = 'retry_used') = 1,
         'retry grant consumed';
  assert (select count(*) from attempts a join players p on p.id = a.player_id
          where p.code = '1002' and a.station_id = v_photo and a.status = 'passed') = 1,
         'new passed attempt exists';
  -- 16 >= 15: retry pass can also trigger the threshold
  assert (select locked_for_life_event from players where code = '1002'),
         'threshold triggers on retry pass too';

  -- === wrong phase ===
  update game_state set phase = 'ended' where id = 1;
  begin
    perform award_scores('test-staff', '[{"code":"1003","score":6}]'::jsonb, v_memory, 'k16');
    raise exception 'TEST FAILED: expected GAME_NOT_PLAYING';
  exception when others then
    if sqlerrm <> 'GAME_NOT_PLAYING' then raise; end if;
  end;

  raise notice 'PASS 03_award_scores';
end $$;
rollback;
