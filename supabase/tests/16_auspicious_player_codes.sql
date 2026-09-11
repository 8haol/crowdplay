-- Tests: 人生编号避讳规则，以及抽号在池子接近见底时仍然正确。
begin;
delete from rpc_results; delete from admin_actions; delete from token_usages;
delete from life_events; delete from life_event_instances; delete from attempts;
delete from team_attempts; delete from players; delete from teams;
update game_state set
  phase = 'waiting', join_open = true, join_token = 'code-test',
  started_at = null, ended_at = null
where id = 1;

do $$
declare
  v_code text;
  i int;
  v_bad int;
begin
  -- 谓词本身
  assert not _player_code_allowed('444'), '444 不可用';
  assert not _player_code_allowed('244'), '244 不可用';
  assert not _player_code_allowed('344'), '344 不可用';
  assert not _player_code_allowed('414'), '含 4 的号码不可用';
  assert not _player_code_allowed('400'), '首位 4 不可用';
  assert not _player_code_allowed('666'), '666 不可用';
  assert not _player_code_allowed('250'), '250 不可用';
  assert not _player_code_allowed('99'),  '100 以下不可用';
  assert not _player_code_allowed('1000'), '四位数不可用';
  assert _player_code_allowed('100'), '100 可用';
  assert _player_code_allowed('888'), '888 可用';
  assert _player_code_allowed('520'), '520 可用';

  -- 可用池大小：8 × 9 × 9 − 666 − 250
  assert (select count(*) from generate_series(100, 999) g
          where _player_code_allowed(g::text)) = 646,
         '可用号码池应为 646 个';

  -- 真实发号：连发 120 个，全部合规且不重复
  for i in 1..120 loop
    select (join_by_link('玩家' || i, 'code-test', null, 'join-' || i)) ->> 'code' into v_code;
    assert _player_code_allowed(v_code), '发出的编号必须合规，收到 ' || v_code;
  end loop;

  assert (select count(*) from players) = 120, '应有 120 名玩家';
  assert (select count(distinct code) from players) = 120, '编号不得重复';

  select count(*) into v_bad from players where not _player_code_allowed(code);
  assert v_bad = 0, '名册里不得存在违规编号';

  raise notice 'PASS 16_auspicious_player_codes';
end $$;
rollback;
