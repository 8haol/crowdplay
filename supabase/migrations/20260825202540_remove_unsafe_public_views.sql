-- Remove views that execute with the owner's privileges. Their safe public
-- data is already available through deliberately exposed RPCs, so keeping
-- security-definer views only widens the anonymous attack surface.
drop view if exists public.public_leaderboard;
drop view if exists public.public_game_state;

-- Immutable helpers still need a fixed search_path so object names cannot be
-- redirected by a role-controlled schema.
alter function public._advance_threshold(integer, integer)
  set search_path = public, pg_temp;
alter function public._player_json(public.players)
  set search_path = public, pg_temp;
