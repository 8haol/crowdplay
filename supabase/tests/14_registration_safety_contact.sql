-- Tests: join idempotency, private follow-up contact and late-join identity.
begin;
delete from rpc_results; delete from admin_actions; delete from token_usages;
delete from life_events; delete from life_event_instances; delete from attempts;
delete from team_attempts; delete from players; delete from teams;
update app_config set value = 'registration-admin' where key = 'admin_key';
update game_state set
  phase = 'waiting', join_open = true, join_token = 'registration-test',
  started_at = null, ended_at = null
where id = 1;

do $$
declare
  first_join jsonb;
  retry_join jsonb;
  late_join jsonb;
  roster jsonb;
begin
  first_join := join_by_link('林沐恩', 'registration-test', 'wxid_life427', 'same-admission');
  retry_join := join_by_link('林沐恩', 'registration-test', 'wxid_life427', 'same-admission');

  assert first_join ->> 'code' = retry_join ->> 'code', 'same admission key returns the first passport';
  assert (select count(*) from players) = 1, 'a retried admission creates one player';
  assert (select contact from players where code = first_join ->> 'code') = 'wxid_life427',
         'optional contact is stored';
  assert not (_player_json((select p from players p where code = first_join ->> 'code')) ? 'contact'),
         'player payload does not expose contact';

  roster := admin_list_players('registration-admin');
  assert roster -> 0 ->> 'contact' = 'wxid_life427', 'admin roster includes contact';

  update game_state set phase = 'playing' where id = 1;
  late_join := join_by_link('迟到者', 'registration-test', null, 'late-admission');
  assert (select identity from players where code = late_join ->> 'code') = 'solo',
         'late joiner remains Solo';
  assert (select team_id from players where code = late_join ->> 'code') is not null,
         'late joiner receives an independent team';

  raise notice 'PASS 14_registration_safety_contact';
end $$;
rollback;
