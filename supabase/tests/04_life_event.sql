-- Tests: apply_life_event — all six cards, threshold skipping, unlock,
-- audit rows, idempotency
begin;
delete from rpc_results; delete from admin_actions; delete from token_usages;
delete from life_events; delete from attempts; delete from players;
update app_config set value = 'test-admin' where key = 'admin_key';
update app_config set value = 'test-staff' where key = 'staff_key';
update game_state set phase = 'playing', join_passphrase = 'pass', started_at = now() where id = 1;

do $$
declare
  r jsonb;
begin
  -- players pre-staged in "just locked at 15" state (score 16, next 35)
  insert into players (name, code, identity, score, locked_for_life_event,
                       pending_threshold, next_threshold) values
    ('双倍', '2001', 'solo', 16, true, 15, 35),
    ('加三', '2002', 'solo', 16, true, 15, 35),
    ('扣五', '2003', 'solo', 16, true, 15, 35),
    ('感冒', '2004', 'solo', 16, true, 15, 35),
    ('结婚', '2005', 'solo', 16, true, 15, 35),
    ('减半', '2006', 'solo', 16, true, 15, 35),
    ('没锁', '2007', 'solo', 5,  false, null, 15),
    ('扣到零', '2008', 'solo', 3, true, 15, 35),
    ('高分双倍', '2009', 'solo', 40, true, 35, 45);

  -- not locked
  begin
    perform apply_life_event('test-staff', '2007', 'fortune_plus3');
    raise exception 'TEST FAILED: expected NOT_LOCKED';
  exception when others then
    if sqlerrm <> 'NOT_LOCKED:2007' then raise; end if;
  end;

  -- bad card
  begin
    perform apply_life_event('test-staff', '2001', 'no_such_card');
    raise exception 'TEST FAILED: expected BAD_CARD';
  exception when others then
    if sqlerrm <> 'BAD_CARD:no_such_card' then raise; end if;
  end;

  -- fortune_double: 16 -> 32, still below 35 => next stays 35
  r := apply_life_event('test-staff', '2001', 'fortune_double', 'le1');
  assert (r ->> 'score_before')::int = 16 and (r ->> 'score_after')::int = 32, 'double math';
  assert (select score from players where code = '2001') = 32, 'score persisted';
  assert not (select locked_for_life_event from players where code = '2001'), 'unlocked';
  assert (select pending_threshold from players where code = '2001') is null, 'pending cleared';
  assert (select next_threshold from players where code = '2001') = 35, 'next unchanged';
  assert (select count(*) from life_events e join players p on p.id = e.player_id
          where p.code = '2001' and e.card_type = 'fortune_double'
            and e.score_before = 16 and e.score_after = 32 and e.threshold = 15) = 1,
         'life_events audit row';

  -- idempotency replay: no double application
  r := apply_life_event('test-staff', '2001', 'fortune_double', 'le1');
  assert (select score from players where code = '2001') = 32, 'replay does not re-apply';

  -- fortune_plus3
  perform apply_life_event('test-staff', '2002', 'fortune_plus3');
  assert (select score from players where code = '2002') = 19, '16 + 3 = 19';

  -- bad_minus5 (and floor at 0)
  perform apply_life_event('test-staff', '2003', 'bad_minus5');
  assert (select score from players where code = '2003') = 11, '16 - 5 = 11';
  perform apply_life_event('test-staff', '2008', 'bad_minus5');
  assert (select score from players where code = '2008') = 0, '3 - 5 floors at 0';

  -- bad_cap_next: no score change, effect set
  perform apply_life_event('test-staff', '2004', 'bad_cap_next');
  assert (select score from players where code = '2004') = 16, 'cap card keeps score';
  assert (select status_effect ->> 'type' from players where code = '2004') = 'cap_next',
         'cap_next effect stored';

  -- unexpected_married: record only
  perform apply_life_event('test-staff', '2005', 'unexpected_married');
  assert (select score from players where code = '2005') = 16, 'married keeps score';
  assert not (select locked_for_life_event from players where code = '2005'), 'still unlocks';

  -- extreme_half: floor division
  perform apply_life_event('test-staff', '2006', 'extreme_half');
  assert (select score from players where code = '2006') = 8, 'floor(16/2) = 8';
  -- score dropped below 15, but 15 was already triggered: next stays 35
  assert (select next_threshold from players where code = '2006') = 35,
         'thresholds never re-arm after a score drop';

  -- double that jumps past the next threshold: 40*2=80 skips 45 without locking
  perform apply_life_event('test-staff', '2009', 'fortune_double');
  assert (select score from players where code = '2009') = 80, '40*2 = 80';
  assert not (select locked_for_life_event from players where code = '2009'),
         'card never locks';
  assert (select next_threshold from players where code = '2009') is null,
         'skipped threshold 45 -> next is null (no more blind boxes)';

  -- unknown player
  begin
    perform apply_life_event('test-staff', '9999', 'fortune_plus3');
    raise exception 'TEST FAILED: expected PLAYER_NOT_FOUND';
  exception when others then
    if sqlerrm <> 'PLAYER_NOT_FOUND:9999' then raise; end if;
  end;

  raise notice 'PASS 04_life_event';
end $$;
rollback;
