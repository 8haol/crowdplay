-- Give Solo players a visible identity color instead of leaving color_group null.
-- Duo/Trio still share one exact team color; Solo uses numbered shades from a
-- related terracotta family, mapped by the frontend as solo-1 ... solo-8.

create or replace function join_game(p_name text, p_passphrase text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state     game_state;
  v_name      text := trim(coalesce(p_name, ''));
  v_code      text;
  v_id        uuid;
  v_solo_slot int;
  i           int;
begin
  select * into v_state from game_state where id = 1 for update;
  if v_state.phase = 'ended' then
    raise exception 'GAME_ENDED';
  end if;
  if trim(coalesce(p_passphrase, '')) is distinct from v_state.join_passphrase then
    raise exception 'BAD_PASSPHRASE';
  end if;
  if length(v_name) < 1 or length(v_name) > 20 then
    raise exception 'BAD_NAME';
  end if;

  if v_state.phase = 'playing' then
    select count(*) + 1 into v_solo_slot
    from players where identity = 'solo' and not is_removed;
  end if;

  for i in 1..100 loop
    v_code := lpad((floor(random() * 9999) + 1)::int::text, 4, '0');
    begin
      insert into players (name, code, identity, color_group)
      values (
        v_name,
        v_code,
        case when v_state.phase = 'playing' then 'solo' end,
        case when v_state.phase = 'playing'
          then 'solo-' || (((v_solo_slot - 1) % 8) + 1)::text
        end
      )
      returning id into v_id;
      return jsonb_build_object('player_id', v_id, 'code', v_code);
    exception when unique_violation then
      -- code collision, try another
    end;
  end loop;
  raise exception 'CODE_POOL_EXHAUSTED';
end;
$$;

create or replace function start_game(p_admin_key text, p_quota jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state      game_state;
  v_trio_q     int := coalesce((p_quota ->> 'trio')::int, 0);
  v_duo_q      int := coalesce((p_quota ->> 'duo')::int, 0);
  v_ids        uuid[];
  v_total      int;
  v_pos        int := 1;
  v_group      int := 0;
  v_trio_made  int := 0;
  v_duo_made   int := 0;
  v_solo_made  int := 0;
  v_palette    text[] := array[
    'red','orange','yellow','green','teal','cyan','blue','indigo',
    'purple','pink','rose','lime','amber','emerald','sky','violet',
    'fuchsia','coral','gold','navy','olive','maroon','plum','mint'
  ];
  v_color      text;
  g            int;
begin
  perform _require_key('admin', p_admin_key);

  select * into v_state from game_state where id = 1 for update;
  if v_state.phase <> 'waiting' then
    raise exception 'ALREADY_STARTED';
  end if;

  select coalesce(array_agg(id order by random()), '{}') into v_ids
  from players where not is_removed;
  v_total := coalesce(array_length(v_ids, 1), 0);
  if v_total = 0 then
    raise exception 'NO_PLAYERS';
  end if;

  while v_trio_made < v_trio_q and v_pos + 2 <= v_total loop
    v_group := v_group + 1;
    v_color := v_palette[(v_group - 1) % array_length(v_palette, 1) + 1]
               || case when v_group > array_length(v_palette, 1)
                       then '-' || ((v_group - 1) / array_length(v_palette, 1) + 1)::text
                       else '' end;
    for g in 0..2 loop
      update players set identity = 'trio', color_group = v_color
      where id = v_ids[v_pos + g];
    end loop;
    v_pos := v_pos + 3;
    v_trio_made := v_trio_made + 1;
  end loop;

  while v_duo_made < v_duo_q and v_pos + 1 <= v_total loop
    v_group := v_group + 1;
    v_color := v_palette[(v_group - 1) % array_length(v_palette, 1) + 1]
               || case when v_group > array_length(v_palette, 1)
                       then '-' || ((v_group - 1) / array_length(v_palette, 1) + 1)::text
                       else '' end;
    for g in 0..1 loop
      update players set identity = 'duo', color_group = v_color
      where id = v_ids[v_pos + g];
    end loop;
    v_pos := v_pos + 2;
    v_duo_made := v_duo_made + 1;
  end loop;

  while v_pos <= v_total loop
    v_solo_made := v_solo_made + 1;
    update players
    set identity = 'solo',
        color_group = 'solo-' || (((v_solo_made - 1) % 8) + 1)::text
    where id = v_ids[v_pos];
    v_pos := v_pos + 1;
  end loop;

  update game_state set phase = 'playing', started_at = now() where id = 1;

  return jsonb_build_object(
    'total_players', v_total,
    'trio_groups', v_trio_made,
    'duo_groups', v_duo_made,
    'solo_players', v_solo_made
  );
end;
$$;

-- Existing games also gain Solo colors when this migration is applied.
with ranked_solos as (
  select id, row_number() over (order by created_at, id) as slot
  from players
  where identity = 'solo' and color_group is null and not is_removed
)
update players p
set color_group = 'solo-' || (((r.slot - 1) % 8) + 1)::text
from ranked_solos r
where p.id = r.id;
