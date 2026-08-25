-- Demo data for the /screen projector page: a mid-game moment with a rich feed.
-- Reset afterwards with: npx supabase db reset
do $$
declare
  s int[] := (select array_agg(id order by sort_order) from stations where type = 'main');
  names text[] := array['恩琪','浩然','以诺','心怡','约书亚','慕恩','雅各','喜乐',
                        '安琪','以撒','路得','提摩太','大卫','沐恩','信望','爱莲',
                        '保罗','马可','路加','彼得'];
  codes text[] := '{}';
  i int;
  r record;
begin
  delete from rpc_results; delete from admin_actions; delete from token_usages;
  delete from life_events; delete from attempts; delete from players;
  update game_state set phase = 'waiting', join_passphrase = 'change-me', started_at = null;

  for i in 1..array_length(names, 1) loop
    codes := codes || ((join_game(names[i], 'change-me')) ->> 'code');
  end loop;

  perform start_game('change-me-admin', '{"trio":4,"duo":3}'::jsonb);

  -- station 1: everybody plays, mixed results
  for i in 1..array_length(codes, 1) loop
    perform award_scores('change-me-staff',
      jsonb_build_array(jsonb_build_object('code', codes[i],
        'score', (array[3,6,9,9,6])[1 + (i % 5)],
        'failed', (i % 7 = 0))),
      s[1], 'ds1-' || i);
  end loop;

  -- station 2: two thirds of the room
  for i in 1..14 loop
    perform award_scores('change-me-staff',
      jsonb_build_array(jsonb_build_object('code', codes[i],
        'score', (array[9,6,3,9])[1 + (i % 4)],
        'failed', (i % 9 = 0))),
      s[2], 'ds2-' || i);
    if (select locked_for_life_event from players where code = codes[i]) then
      perform apply_life_event('change-me-staff', codes[i],
        (array['fortune_double','fortune_plus3','bad_minus5','bad_cap_next',
               'unexpected_married','extreme_half'])[1 + (i % 6)],
        'dle2-' || i);
    end if;
  end loop;

  -- station 3: the leaders push on
  for i in 1..8 loop
    perform award_scores('change-me-staff',
      jsonb_build_array(jsonb_build_object('code', codes[i], 'score', (array[9,6])[1 + (i % 2)])),
      s[3], 'ds3-' || i);
    if (select locked_for_life_event from players where code = codes[i]) then
      perform apply_life_event('change-me-staff', codes[i],
        (array['fortune_plus3','bad_minus5','fortune_double'])[1 + (i % 3)],
        'dle3-' || i);
    end if;
  end loop;

  -- grace station traffic: second chances go to people who actually failed
  perform use_token('change-me-staff', codes[3], 'hint', null, 'dt2');
  perform use_token('change-me-staff', codes[11], 'grace_card', null, 'dt3');
  for r in
    select p.code, a.station_id
    from attempts a
    join players p on p.id = a.player_id
    where a.status = 'failed' and p.token_available
    limit 2
  loop
    perform use_token('change-me-staff', r.code, 'second_chance', r.station_id,
                      'dt-sc-' || r.code);
  end loop;

  -- leave two people mid-blind-box so the board shows the locked state
  for i in 15..16 loop
    perform award_scores('change-me-staff',
      jsonb_build_array(jsonb_build_object('code', codes[i], 'score', 9)),
      s[2], 'ds4-' || i);
  end loop;

  raise notice 'demo ready: % players', array_length(codes, 1);
end $$;

select name, score, identity, locked_for_life_event as locked
from players order by score desc limit 8;
