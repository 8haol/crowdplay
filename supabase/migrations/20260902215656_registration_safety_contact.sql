-- Life Passport registration safety and optional follow-up contact.
--
-- Contact details are private event data. They are deliberately omitted from
-- _player_json, so player polling, staff lookup, teammates and the projector
-- never receive them. Only admin roster/detail RPCs include the field.

alter table public.players add column if not exists contact text;

alter table public.players drop constraint if exists players_contact_length;
alter table public.players add constraint players_contact_length
  check (contact is null or length(contact) between 1 and 80);

comment on column public.players.contact is
  'Optional WeChat ID or WhatsApp contact supplied for post-event follow-up. Admin-only PII; never include in player, staff or board payloads.';

-- Replace the two-argument entry point with a backwards-compatible function:
-- older clients may omit the two new defaulted arguments, while current
-- clients send an idempotency key so retries return the original passport.
drop function if exists public.join_by_link(text, text);

create function public.join_by_link(
  p_name text,
  p_join_token text,
  p_contact text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state public.game_state;
  v_name text := trim(coalesce(p_name, ''));
  v_contact text := nullif(trim(coalesce(p_contact, '')), '');
  v_idem text;
  v_previous jsonb;
  v_new record;
  v_team uuid;
  v_color text;
  v_result jsonb;
begin
  -- The row lock serialises admissions. It also closes the narrow race where
  -- two concurrent retries could both miss rpc_results and create two rows.
  select * into v_state from public.game_state where id = 1 for update;

  if p_join_token is distinct from v_state.join_token then
    if exists (select 1 from public.game_archives where join_token = p_join_token) then
      raise exception 'GAME_ARCHIVED';
    end if;
    raise exception 'BAD_GAME_LINK';
  end if;
  if not v_state.join_open then raise exception 'JOIN_CLOSED'; end if;
  if v_state.phase = 'ended' then raise exception 'GAME_ARCHIVED'; end if;
  if length(v_name) < 1 or length(v_name) > 20 then raise exception 'BAD_NAME'; end if;
  if v_contact is not null and length(v_contact) > 80 then raise exception 'BAD_CONTACT'; end if;

  if nullif(trim(coalesce(p_idempotency_key, '')), '') is not null then
    v_idem := 'join:' || v_state.event_id::text || ':' || trim(p_idempotency_key);
    select result into v_previous from public.rpc_results where idempotency_key = v_idem;
    if found then return v_previous; end if;
  end if;

  select * into v_new from public._new_player_code(v_name);
  update public.players set contact = v_contact where id = v_new.player_id;

  -- Teams are already active and may already have station attempts. A late
  -- arrival therefore gets an independent Solo team instead of mutating an
  -- existing Duo/Trio and inheriting an ambiguous journey state.
  if v_state.phase = 'playing' then
    v_color := 'solo-' || (((select count(*) from public.teams where identity = 'solo') % 8) + 1)::text;
    v_team := public._make_team('solo', v_color);
    update public.players set identity = 'solo', color_group = v_color, team_id = v_team
    where id = v_new.player_id;
  end if;

  v_result := jsonb_build_object(
    'player_id', v_new.player_id,
    'code', v_new.code,
    'event_id', v_state.event_id,
    'title', v_state.title
  );

  if v_idem is not null then
    insert into public.rpc_results (idempotency_key, result) values (v_idem, v_result);
  end if;
  return v_result;
end;
$$;
revoke execute on function public.join_by_link(text, text, text, text) from public;
grant execute on function public.join_by_link(text, text, text, text) to anon, authenticated;

-- Current and archived event detail: admin-only contact access.
create or replace function public._current_players_detail()
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(
    public._player_json(p.*) || jsonb_build_object(
      'contact', p.contact,
      'is_removed', p.is_removed,
      'created_at', p.created_at,
      'attempt_count', (select count(*) from public.attempts a where a.player_id = p.id and a.status in ('passed','failed')),
      'attempts', coalesce((select jsonb_agg(jsonb_build_object(
        'station_id', a.station_id, 'station_name', s.name_zh, 'status', a.status,
        'score', a.score, 'created_at', a.created_at
      ) order by a.created_at) from public.attempts a join public.stations s on s.id = a.station_id
        where a.player_id = p.id and a.status in ('passed','failed')), '[]'::jsonb),
      'life_events', coalesce((select jsonb_agg(jsonb_build_object(
        'card_type', e.card_type, 'card_label', e.card_label,
        'scene_title', e.scene_title, 'choice_label', e.choice_label,
        'outcome_detail', e.outcome_detail,
        'score_before', e.score_before, 'score_after', e.score_after,
        'created_at', e.created_at
      ) order by e.created_at) from public.life_events e where e.player_id = p.id), '[]'::jsonb),
      'token_usages', coalesce((select jsonb_agg(jsonb_build_object(
        'usage_type', u.usage_type, 'target_station_id', u.target_station_id, 'created_at', u.created_at
      ) order by u.created_at) from public.token_usages u where u.player_id = p.id), '[]'::jsonb)
    ) order by p.score desc, p.created_at
  ), '[]'::jsonb) from public.players p;
$$;

revoke execute on function public._current_players_detail() from public, anon, authenticated;

create or replace function public.admin_list_players(p_admin_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_key('admin', p_admin_key);
  return coalesce((
    select jsonb_agg(
      public._player_json(p.*) || jsonb_build_object(
        'contact', p.contact,
        'is_removed', p.is_removed,
        'created_at', p.created_at,
        'attempt_count', (select count(*) from public.attempts a
                          where a.player_id = p.id and a.status in ('passed', 'failed'))
      ) order by p.created_at)
    from public.players p
  ), '[]'::jsonb);
end;
$$;
