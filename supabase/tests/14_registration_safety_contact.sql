-- Tests: join idempotency, private follow-up contact and late-join identity.
begin;
delete from events; delete from organizations;
insert into organizations (slug, name_zh, name_en, admin_key) values ('tc', '测试教会', 'Test Church', 'test-admin');
insert into events (org_id, title, join_token, staff_code, screen_token, phase, started_at)
select id, '测试场', 'join-t', 'STAFF1', 'screen-t', 'waiting', null from organizations where slug = 'tc';

do $$
declare
  v_ev uuid := (select id from events where join_token = 'join-t');
  first_join jsonb; retry_join jsonb; late_join jsonb; roster jsonb;
begin
  first_join := join_by_link('林沐恩', 'join-t', 'wxid_life427', 'same-admission');
  retry_join := join_by_link('林沐恩', 'join-t', 'wxid_life427', 'same-admission');

  assert first_join ->> 'code' = retry_join ->> 'code', 'same admission key returns the first passport';
  assert (select count(*) from players) = 1, 'a retried admission creates one player';
  assert (select contact from players where code = first_join ->> 'code') = 'wxid_life427', 'optional contact is stored';
  assert not (_player_json((select p from players p where code = first_join ->> 'code')) ? 'contact'), 'player payload does not expose contact';

  roster := admin_list_players('test-admin', v_ev);
  assert roster -> 0 ->> 'contact' = 'wxid_life427', 'admin roster includes contact';

  update events set phase = 'playing', started_at = now() where id = v_ev;
  late_join := join_by_link('迟到者', 'join-t', null, 'late-admission');
  assert (select identity from players where code = late_join ->> 'code') = 'solo', 'late joiner remains Solo';
  assert (select team_id from players where code = late_join ->> 'code') is not null, 'late joiner receives an independent team';

  raise notice 'PASS 14_registration_safety_contact';
end $$;
rollback;
