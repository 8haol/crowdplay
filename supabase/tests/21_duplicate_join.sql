-- Tests: duplicate-name guard on join, forced join, recover by contact
begin;
delete from events; delete from organizations;
insert into organizations (slug, name_zh, name_en, admin_key) values ('tc', '测试教会', 'Test Church', 'test-admin');
insert into events (org_id, title, join_token, staff_code, screen_token) select id, '测试场', 'join-t', 'STAFF1', 'screen-t' from organizations where slug = 'tc';

do $$
declare r jsonb; first_code text; second_code text;
begin
  r := join_by_link('林沐恩', 'join-t', 'wx_muen_2026', 'k1');
  first_code := r ->> 'code';
  assert first_code is not null, 'first join creates a player';

  -- same idempotency key replays the stored result, never the duplicate card
  r := join_by_link('林沐恩', 'join-t', 'wx_muen_2026', 'k1');
  assert r ->> 'code' = first_code, 'idempotent retry returns the original join';

  -- same normalised name (spaces, full-width space, case) → duplicate card, no new row
  r := join_by_link(' 林 沐恩　', 'join-t');
  assert r ? 'duplicate', 'second join with same name returns duplicate, got ' || r::text;
  assert r -> 'duplicate' ->> 'name' = '林沐恩', 'card names the existing player';
  assert r -> 'duplicate' ->> 'code_hint' = left(first_code, 1) || '●●', 'code hint masks two digits';
  assert (r -> 'duplicate' ->> 'has_contact')::boolean, 'knows a contact exists';
  assert r -> 'duplicate' ->> 'contact_hint' = 'wx…26', 'contact hint shows two chars each side, got ' || (r -> 'duplicate' ->> 'contact_hint');
  assert not (r ? 'code'), 'duplicate card carries no code';
  assert (select count(*) from players where name like '%林%') = 1, 'no second row';
  r := join_by_link('Anna Lee', 'join-t');
  r := join_by_link('annalee', 'join-t');
  assert r ? 'duplicate', 'latin names compare case- and space-insensitively';

  -- force creates a second row
  r := join_by_link('林沐恩', 'join-t', null, 'k2', true);
  second_code := r ->> 'code';
  assert second_code is not null and second_code <> first_code, 'forced join creates a new player';
  assert (select count(*) from players where name like '%林%') = 2, 'two rows after force';

  -- a third namesake still gets the card, and it points at the earliest registration
  -- (both rows were inserted in this transaction, so pin the second one later in time)
  update players set created_at = created_at + interval '1 minute' where code = second_code;
  r := join_by_link('林沐恩', 'join-t');
  assert r -> 'duplicate' ->> 'code_hint' = left(first_code, 1) || '●●', 'card points at the first registration';

  -- removed players do not block a name
  update players set is_removed = true where code in (first_code, second_code);
  r := join_by_link('林沐恩', 'join-t', 'wx_other', 'k3');
  assert r ->> 'code' is not null, 'removed namesakes do not trigger the card';
  update players set is_removed = false where code in (first_code, second_code);

  -- recover by contact: case-insensitive, returns the matching (earliest) player
  r := recover_by_contact('join-t', '林沐恩', 'WX_MUEN_2026 ');
  assert r ->> 'code' = first_code, 'contact match is case-insensitive and returns the original code';
  assert r ? 'stations_total', 'returns _player_json';
  r := recover_by_contact('join-t', ' 林沐恩', 'wx_other');
  assert r ->> 'code' <> first_code and r ->> 'code' <> second_code, 'contact picks the right namesake';

  -- wrong contact / wrong name / player without contact → PLAYER_NOT_FOUND
  begin
    perform recover_by_contact('join-t', '林沐恩', 'wrong');
    raise exception 'TEST FAILED: expected PLAYER_NOT_FOUND';
  exception when others then
    if position('PLAYER_NOT_FOUND' in sqlerrm) = 0 then raise; end if;
  end;
  begin
    perform recover_by_contact('join-t', '别人', 'wx_muen_2026');
    raise exception 'TEST FAILED: expected PLAYER_NOT_FOUND';
  exception when others then
    if position('PLAYER_NOT_FOUND' in sqlerrm) = 0 then raise; end if;
  end;
  begin
    perform recover_by_contact('join-t', '林沐恩', '');
    raise exception 'TEST FAILED: expected PLAYER_NOT_FOUND';
  exception when others then
    if position('PLAYER_NOT_FOUND' in sqlerrm) = 0 then raise; end if;
  end;

  -- anon can call both
  set local role anon;
  r := recover_by_contact('join-t', '林沐恩', 'wx_muen_2026');
  assert r ->> 'code' = first_code, 'anon may recover by contact';
  r := join_by_link('林沐恩', 'join-t');
  assert r ? 'duplicate', 'anon gets the duplicate card';
  reset role;
  raise notice 'PASS 21_duplicate_join';
end $$;
rollback;
