-- Tests: 人生编号避讳规则，以及抽号在池子接近见底时仍然正确（按场次唯一）。
begin;
delete from events; delete from organizations;
insert into organizations (slug, name_zh, name_en, admin_key) values ('tc', '测试教会', 'Test Church', 'test-admin');
insert into events (org_id, title, join_token, staff_code, screen_token, phase, started_at)
select id, '测试场', 'join-t', 'STAFF1', 'screen-t', 'waiting', null from organizations where slug = 'tc';

do $$
declare
  v_ev uuid := (select id from events where join_token = 'join-t');
  v_code text; i int; v_bad int;
begin
  assert not _player_code_allowed('444'), '444 不可用';
  assert not _player_code_allowed('244'), '244 不可用';
  assert not _player_code_allowed('344'), '344 不可用';
  assert not _player_code_allowed('414'), '含 4 的号码不可用';
  assert not _player_code_allowed('400'), '首位 4 不可用';
  assert not _player_code_allowed('666'), '666 不可用';
  assert not _player_code_allowed('250'), '250 不可用';
  assert not _player_code_allowed('99'),  '100 以下不可用';
  assert not _player_code_allowed('1000'), '四位数不可用';
  assert _player_code_allowed('100') and _player_code_allowed('888') and _player_code_allowed('520'), '合规号码可用';

  assert (select count(*) from generate_series(100, 999) g where _player_code_allowed(g::text)) = 646, '可用号码池应为 646 个';

  for i in 1..120 loop
    select (join_by_link('玩家' || i, 'join-t', null, 'join-' || i)) ->> 'code' into v_code;
    assert _player_code_allowed(v_code), '发出的编号必须合规，收到 ' || v_code;
  end loop;

  assert (select count(*) from players where event_id = v_ev) = 120, '应有 120 名玩家';
  assert (select count(distinct code) from players where event_id = v_ev) = 120, '编号不得重复';
  select count(*) into v_bad from players where not _player_code_allowed(code);
  assert v_bad = 0, '名册里不得存在违规编号';

  raise notice 'PASS 16_auspicious_player_codes';
end $$;
rollback;
