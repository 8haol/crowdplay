-- Tests: use_team_token / redeem_token_card — hint, second chance, one token per person
begin;
delete from events; delete from organizations;
insert into organizations (slug, name_zh, name_en, admin_key) values ('tc', '测试教会', 'Test Church', 'test-admin');
insert into events (org_id, title, join_token, staff_code, screen_token, phase, started_at)
select id, '测试场', 'join-t', 'STAFF1', 'screen-t', 'playing', now() from organizations where slug = 'tc';

do $$
declare
  v_ev uuid := (select id from events where join_token = 'join-t');
  v_music int := (select id from stations where slug = 'music');
  v_uk    int := (select id from stations where slug = 'uk-life');
  ta uuid; tb uuid; tc uuid; td uuid;
  r jsonb;
begin
  ta := _make_team(v_ev, 'solo', 'solo-1'); tb := _make_team(v_ev, 'duo', 'red');
  tc := _make_team(v_ev, 'solo', 'solo-2'); td := _make_team(v_ev, 'solo', 'solo-3');
  insert into players (event_id, name, code, identity, color_group, team_id) values
    (v_ev, 'A',  '101', 'solo', 'solo-1', ta),
    (v_ev, 'B1', '102', 'duo',  'red',    tb), (v_ev, 'B2', '103', 'duo', 'red', tb),
    (v_ev, 'C',  '104', 'solo', 'solo-2', tc),
    (v_ev, 'D',  '105', 'solo', 'solo-3', td);

  -- hint: records usage for every member, burns tokens
  r := use_team_token('STAFF1', '101', 'hint', null, 'tk1');
  assert r ->> 'usage_type' = 'hint', 'hint recorded';
  assert not (select token_available from players where code = '101'), 'token burned';
  assert (select count(*) from token_usages t join players p on p.id = t.player_id where p.code = '101' and t.usage_type = 'hint') = 1, 'usage row';
  assert (select event_id from token_usages limit 1) = v_ev, 'usage row is stamped with the event';

  -- idempotent replay adds no row
  r := use_team_token('STAFF1', '101', 'hint', null, 'tk1');
  assert (select count(*) from token_usages t join players p on p.id = t.player_id where p.code = '101') = 1, 'replay adds no usage row';

  -- no token left
  begin
    perform use_team_token('STAFF1', '101', 'hint', null, 'tk2');
    raise exception 'TEST FAILED: expected TEAM_TOKEN_INCOMPLETE';
  exception when others then
    if sqlerrm not like 'TEAM_TOKEN_INCOMPLETE:%' then raise; end if;
  end;

  -- second_chance requires a station, and one the team has played
  begin
    perform use_team_token('STAFF1', '102', 'second_chance', null, 'tk3');
    raise exception 'TEST FAILED: expected STATION_REQUIRED';
  exception when others then
    if sqlerrm <> 'STATION_REQUIRED' then raise; end if;
  end;
  begin
    perform use_team_token('STAFF1', '102', 'second_chance', v_music, 'tk4');
    raise exception 'TEST FAILED: expected TEAM_NOT_ATTEMPTED';
  exception when others then
    if sqlerrm not like 'TEAM_NOT_ATTEMPTED:%' then raise; end if;
  end;

  -- happy path: duo fails uk-life, buys a second chance; both members pay
  perform award_team_score('STAFF1', '102', v_uk, 0, true, 'tk5');
  r := use_team_token('STAFF1', '103', 'second_chance', v_uk, 'tk6');
  assert (r ->> 'target_station_id')::int = v_uk, 'target recorded';
  assert (select count(*) from attempts a join players p on p.id = a.player_id where p.team_id = tb and a.station_id = v_uk and a.status = 'retry_granted') = 2,
         'retry mirrored onto both passports';
  assert (select count(*) from players where team_id = tb and not token_available) = 2, 'duo help costs both tokens';

  -- a second grant on the same station is refused once tokens are back
  perform award_team_score('STAFF1', '104', v_uk, 0, true, 'tk7');
  perform use_team_token('STAFF1', '104', 'second_chance', v_uk, 'tk8');
  perform admin_adjust('test-admin', v_ev, '104', p_restore_token => true, p_reason => 't');
  begin
    perform use_team_token('STAFF1', '104', 'second_chance', v_uk, 'tk9');
    raise exception 'TEST FAILED: expected RETRY_ALREADY_GRANTED';
  exception when others then
    if sqlerrm not like 'RETRY_ALREADY_GRANTED:%' then raise; end if;
  end;

  -- bad usage type
  begin
    perform use_team_token('STAFF1', '105', 'teleport', null, 'tk10');
    raise exception 'TEST FAILED: expected BAD_USAGE_TYPE';
  exception when others then
    if sqlerrm <> 'BAD_USAGE_TYPE' then raise; end if;
  end;

  -- keepsake card: personal, mid-event
  r := redeem_token_card('STAFF1', '105', 'card-1');
  assert r ->> 'usage_type' = 'grace_card', 'card redeemed';
  assert not (select token_available from players where code = '105'), 'card burns the token';
  begin
    perform redeem_token_card('STAFF1', '101', 'card-2');
    raise exception 'TEST FAILED: expected NO_TOKEN';
  exception when others then
    if sqlerrm <> 'NO_TOKEN:101' then raise; end if;
  end;

  -- not before the game starts
  update events set phase = 'waiting' where id = v_ev;
  update players set token_available = true where code = '105';
  begin
    perform redeem_token_card('STAFF1', '105', 'card-3');
    raise exception 'TEST FAILED: expected CARD_REDEMPTION_NOT_OPEN';
  exception when others then
    if sqlerrm <> 'CARD_REDEMPTION_NOT_OPEN' then raise; end if;
  end;

  raise notice 'PASS 05_token';
end $$;
rollback;
