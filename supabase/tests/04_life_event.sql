-- Tests: digital life-event state machine — gates, one pending at a time, hidden outcomes,
-- choose/replay/cancel, admin unlock.
begin;
delete from events; delete from organizations;
insert into organizations (slug, name_zh, name_en, admin_key) values ('tc', '测试教会', 'Test Church', 'test-admin');
insert into events (org_id, title, join_token, staff_code, screen_token, phase, started_at)
select id, '测试场', 'join-t', 'STAFF1', 'screen-t', 'playing', now() from organizations where slug = 'tc';

do $$
declare
  v_ev uuid := (select id from events where join_token = 'join-t');
  t1 uuid;
  p1 uuid;
  v_inst uuid;
  v_inst2 uuid;
  v_inst3 uuid;
  pending jsonb;
  r jsonb;
begin
  t1 := _make_team(v_ev, 'solo', 'solo-1');
  insert into players (event_id, name, code, identity, color_group, team_id) values (v_ev, '独行', '101', 'solo', 'solo-1', t1)
  returning id into p1;

  -- nothing due at 0 points / 0 stations
  assert _sync_life_event(p1) is null, 'no event owed at the start';
  assert not (select locked_for_life_event from players where id = p1), 'not locked';

  -- 15 points opens stage 1
  update players set score = 15 where id = p1;
  v_inst := _sync_life_event(p1);
  assert v_inst is not null, 'the 15-point gate opens stage 1';
  assert (select locked_for_life_event from players where id = p1), 'player is locked while an event is pending';
  assert (select pending_stage from players where id = p1) = 1, 'pending stage recorded';
  assert (select event_id from life_event_instances where id = v_inst) = v_ev, 'instance is stamped with the event';

  -- one pending at a time
  assert _sync_life_event(p1) is null, 'a second sync does not open another event';

  -- hidden outcomes never reach the browser payload
  pending := _pending_event_json(p1);
  assert (pending ->> 'stage')::int = 1, 'pending payload carries its stage';
  assert position('outcomes' in pending::text) = 0, 'hidden outcomes are stripped';

  -- bad choice
  begin
    perform choose_life_event_by_link('join-t', '101', v_inst, 'no-such-choice', 'le-bad');
    raise exception 'TEST FAILED: expected BAD_EVENT_CHOICE';
  exception when others then
    if sqlerrm <> 'BAD_EVENT_CHOICE' then raise; end if;
  end;

  -- choose → resolved, unlocked, audit row written
  r := choose_life_event_by_link('join-t', '101', v_inst, pending -> 'choices' -> 0 ->> 'key', 'le-1');
  assert r ->> 'outcome_label' is not null, 'one outcome chosen';
  assert (r ->> 'stage')::int = 1, 'result reports its stage';
  assert (select state from life_event_instances where id = v_inst) = 'resolved', 'instance resolved';
  assert not (select locked_for_life_event from players where id = p1), 'unlocked after choosing';
  assert (select count(*) from life_events where player_id = p1 and stage = 1) = 1, 'life_events audit row';
  assert (select event_id from life_events where player_id = p1) = v_ev, 'audit row is stamped with the event';

  -- choosing again returns the stored result, nothing re-applied
  assert choose_life_event_by_link('join-t', '101', v_inst, 'anything', 'le-1') ->> 'outcome_label' = r ->> 'outcome_label',
         'a resolved event replays its snapshot';
  assert (select count(*) from life_events where player_id = p1) = 1, 'no second audit row';

  -- stage 2 opens at 35; admin unlock cancels it, and that stage is then over for good:
  -- one instance per (player, stage) is enforced by the schema, so a cancelled stage
  -- is skipped rather than re-issued.
  update players set score = 35 where id = p1;
  v_inst2 := _sync_life_event(p1);
  assert (select stage from life_event_instances where id = v_inst2) = 2, 'stage 2 follows';
  perform admin_adjust('test-admin', v_ev, '101', p_unlock => true, p_reason => '卡住了');
  assert (select state from life_event_instances where id = v_inst2) = 'cancelled', 'admin unlock cancels the pending event';
  assert not (select locked_for_life_event from players where id = p1), 'admin unlock releases the player';
  assert _sync_life_event(p1) is null, 'a cancelled stage is not re-issued';
  assert (select count(*) from life_event_instances where player_id = p1 and stage = 2) = 1, 'still exactly one stage-2 instance';
  assert _next_stage(p1) = 3, 'the passport moves on to the final stage';
  -- and the final stage still arrives when earned. (Assign first: a row inserted by a
  -- function called inside a SELECT is not visible to that same statement's snapshot.)
  update players set score = 45 where id = p1;
  v_inst3 := _sync_life_event(p1);
  assert v_inst3 is not null, 'stage 3 is issued after the skip';
  assert (select stage from life_event_instances where id = v_inst3) = 3, 'and it is stage 3';

  -- choosing on a cancelled instance is refused
  begin
    perform choose_life_event_by_link('join-t', '101', v_inst2, 'x', 'le-cancelled');
    raise exception 'TEST FAILED: expected EVENT_NOT_PENDING';
  exception when others then
    if sqlerrm <> 'EVENT_NOT_PENDING' then raise; end if;
  end;

  raise notice 'PASS 04_life_event';
end $$;
rollback;
