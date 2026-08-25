-- Big-screen board (projector view). One merged snapshot per poll.
--
-- PRIVACY: this RPC deliberately returns NO 4-digit codes. The code is the
-- player's identity credential (anyone holding it can open that passport),
-- and this payload is displayed on a projector in a public room.
-- player_id is included instead: it is a stable React key and is not
-- accepted as an identifier by any RPC.

create or replace function board_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state game_state;
begin
  select * into v_state from game_state where id = 1;

  return jsonb_build_object(
    'phase', v_state.phase,
    'started_at', v_state.started_at,

    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id,
               'name', p.name,
               'identity', p.identity,
               'color_group', p.color_group,
               'score', p.score,
               'locked', p.locked_for_life_event,
               'token_available', p.token_available,
               'sick', (p.status_effect ->> 'type') = 'cap_next',
               'stations_done', (
                 select count(*) from attempts a
                 where a.player_id = p.id and a.status in ('passed', 'failed'))
             ) order by p.score desc, p.created_at)
      from players p
      where not p.is_removed
    ), '[]'::jsonb),

    'stats', jsonb_build_object(
      'players', (select count(*) from players where not is_removed),
      'stamps', (select count(*) from attempts a
                 join players p on p.id = a.player_id
                 where not p.is_removed and a.status in ('passed', 'failed')),
      'life_events', (select count(*) from life_events e
                      join players p on p.id = e.player_id
                      where not p.is_removed),
      'tokens_used', (select count(*) from token_usages t
                      join players p on p.id = t.player_id
                      where not p.is_removed),
      'top_score', coalesce((select max(score) from players where not is_removed), 0)
    ),

    'feed', coalesce((
      select jsonb_agg(item order by created_at desc)
      from (
        select created_at, item from (
          -- blind-box cards
          select e.created_at,
                 jsonb_build_object(
                   'id', 'e' || e.id,
                   'kind', 'life_event',
                   'name', p.name,
                   'card', e.card_type,
                   'label', e.card_label,
                   'threshold', e.threshold,
                   'before', e.score_before,
                   'after', e.score_after,
                   'at', e.created_at) as item
          from life_events e
          join players p on p.id = e.player_id
          where not p.is_removed

          union all

          -- station results (a retry that superseded a fail is excluded:
          -- only the standing pass/fail rows appear)
          select a.created_at,
                 jsonb_build_object(
                   'id', 'a' || a.id,
                   'kind', 'attempt',
                   'name', p.name,
                   'station', s.name_zh,
                   'status', a.status,
                   'score', a.score,
                   'total', p.score,
                   'at', a.created_at)
          from attempts a
          join players p on p.id = a.player_id
          join stations s on s.id = a.station_id
          where not p.is_removed and a.status in ('passed', 'failed')

          union all

          -- grace station
          select t.created_at,
                 jsonb_build_object(
                   'id', 't' || t.id,
                   'kind', 'token',
                   'name', p.name,
                   'usage', t.usage_type,
                   'station', s.name_zh,
                   'at', t.created_at)
          from token_usages t
          join players p on p.id = t.player_id
          left join stations s on s.id = t.target_station_id
          where not p.is_removed
        ) all_events
        order by created_at desc
        limit 60
      ) recent
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function board_snapshot() to anon, authenticated;

-- The board feed is a chronological ticker, so event rows need real insertion
-- times: now() returns the transaction timestamp, which makes every row written
-- by one award_scores batch tie and scramble the feed order. clock_timestamp()
-- advances inside a transaction (microsecond resolution), so the ticker matches
-- the order things actually happened.
alter table attempts     alter column created_at set default clock_timestamp();
alter table life_events   alter column created_at set default clock_timestamp();
alter table token_usages  alter column created_at set default clock_timestamp();
