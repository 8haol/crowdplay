-- Tests: join_by_link / recover_by_link / poll_player_by_link basics
begin;
delete from events; delete from organizations;
insert into organizations (slug, name_zh, name_en, admin_key) values ('tc', '测试教会', 'Test Church', 'test-admin');
insert into events (org_id, title, join_token, staff_code, screen_token, phase, started_at)
select id, '测试场', 'join-t', 'STAFF1', 'screen-t', 'waiting', null from organizations where slug = 'tc';

do $$
declare
  r jsonb;
  v_code text;
begin
  -- bad link
  begin
    perform join_by_link('小明', 'not-a-token');
    raise exception 'TEST FAILED: expected BAD_GAME_LINK';
  exception when others then
    if sqlerrm <> 'BAD_GAME_LINK' then raise; end if;
  end;

  -- empty name
  begin
    perform join_by_link('   ', 'join-t');
    raise exception 'TEST FAILED: expected BAD_NAME';
  exception when others then
    if sqlerrm <> 'BAD_NAME' then raise; end if;
  end;

  -- happy path: three digits, identity null while waiting
  r := join_by_link('小明', 'join-t');
  v_code := r ->> 'code';
  assert v_code ~ '^[1-9]\d{2}$', 'code is three digits with no leading zero, got ' || v_code;
  assert r ->> 'title' = '测试场', 'join returns the event title';
  assert (select identity from players where code = v_code) is null, 'identity must be null while waiting';

  -- recover by code
  r := recover_by_link('join-t', v_code);
  assert r ->> 'name' = '小明', 'recover returns the player';
  assert (r ->> 'score')::int = 0, 'fresh player has score 0';

  -- recover unknown code
  begin
    perform recover_by_link('join-t', '000');
    raise exception 'TEST FAILED: expected PLAYER_NOT_FOUND';
  exception when others then
    if sqlerrm <> 'PLAYER_NOT_FOUND:000' then raise; end if;
  end;

  -- poll returns merged state incl. org branding
  r := poll_player_by_link('join-t', v_code);
  assert r ->> 'phase' = 'waiting', 'poll includes phase';
  assert r -> 'player' ->> 'code' = v_code, 'poll includes player';
  assert r -> 'org' ->> 'name_zh' = '测试教会', 'poll carries the organisation for branding';
  assert jsonb_array_length(r -> 'attempts') = 0, 'no attempts yet';
  assert (r ->> 'rank')::int = 1, 'rank present';

  -- joining mid-game gets solo identity immediately
  update events set phase = 'playing', started_at = now() where join_token = 'join-t';
  r := join_by_link('迟到者', 'join-t');
  assert (select identity from players where code = r ->> 'code') = 'solo', 'late joiner becomes solo';
  assert (select color_group from players where code = r ->> 'code') like 'solo-%', 'late solo receives a solo color';

  -- joining after the game ended is rejected
  update events set phase = 'ended' where join_token = 'join-t';
  begin
    perform join_by_link('太晚了', 'join-t');
    raise exception 'TEST FAILED: expected GAME_ARCHIVED';
  exception when others then
    if sqlerrm <> 'GAME_ARCHIVED' then raise; end if;
  end;

  raise notice 'PASS 01_join_recover';
end $$;
rollback;
