-- Automatic virtual valuation v1. Safe to rerun; no reports or players are deleted.
-- Base 50,000 + experience (2,000/game, max 50 games) + form (max 200,000).
-- Form uses the last 20 official matches, five neutral prior matches and a 20-point/game cap.
-- Recomputing from source data makes corrections/deletions idempotent.
BEGIN;
CREATE OR REPLACE FUNCTION public.player_virtual_value(p_player uuid)
RETURNS bigint LANGUAGE sql STABLE SET search_path = '' AS $$
 WITH per_game AS (
   SELECT m.id, m.created_at,
     least(20::numeric,
       greatest(0, sum(s.goles)) * 3
       + greatest(0, sum(s.asistencias)) * 2
       + least(14::numeric, greatest(0, sum(s.valla_invicta_segundos)) / 60.0) * 1.5
       + CASE WHEN bool_or((s.club_id = m.club_local_id AND m.goles_local > m.goles_visitante)
                        OR (s.club_id = m.club_visitante_id AND m.goles_visitante > m.goles_local)) THEN 2 ELSE 0 END
       + CASE WHEN bool_or(s.es_mvp) THEN 3 ELSE 0 END
       + CASE WHEN bool_or(s.es_destacado) THEN 1 ELSE 0 END
     ) AS performance
   FROM public.estadisticas_jugador s
   JOIN public.partidos m ON m.id = s.partido_id AND m.jugado
   JOIN public.torneos t ON t.id = m.torneo_id
   JOIN public.jugadores p ON p.id = s.jugador_id
   WHERE s.jugador_id = p_player AND s.club_id IN (m.club_local_id, m.club_visitante_id)
     AND (p.discord_guild_id = '1477848311019864106' OR p.discord_guild_id = CASE t.tipo
       WHEN 'ash' THEN '1293616776747286631'
       WHEN 'exclusivo' THEN '1400962843674804264'
       WHEN 'tematico' THEN '1513342723594129458' END)
   GROUP BY m.id, m.created_at
 ), recent AS (
   SELECT performance FROM per_game ORDER BY created_at DESC, id DESC LIMIT 20
 )
 SELECT (round((50000 + 2000 * least(50, (SELECT count(*) FROM per_game))
   + coalesce((SELECT sum(performance) * 10000 / (count(*) + 5) FROM recent), 0)) / 1000) * 1000)::bigint;
$$;
REVOKE ALL ON FUNCTION public.player_virtual_value(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.player_virtual_value(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_player_virtual_values(p_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 -- Serialize valuation refreshes, including report replacements.
 PERFORM pg_advisory_xact_lock(78201933);
 UPDATE public.jugadores p SET valuacion = public.player_virtual_value(p.id)
 WHERE p.id = ANY(p_ids) AND p.valuacion IS DISTINCT FROM public.player_virtual_value(p.id);
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_player_virtual_values(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_player_virtual_values(uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.stats_virtual_values_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE affected uuid[];
BEGIN
 IF TG_OP = 'INSERT' THEN
   SELECT array_agg(DISTINCT jugador_id) INTO affected FROM new_stats WHERE jugador_id IS NOT NULL;
 ELSIF TG_OP = 'DELETE' THEN
   SELECT array_agg(DISTINCT jugador_id) INTO affected FROM old_stats WHERE jugador_id IS NOT NULL;
 ELSE
   SELECT array_agg(DISTINCT jugador_id) INTO affected FROM (
     SELECT jugador_id FROM old_stats UNION SELECT jugador_id FROM new_stats
   ) changed WHERE jugador_id IS NOT NULL;
 END IF;
 IF cardinality(affected) > 0 THEN PERFORM public.refresh_player_virtual_values(affected); END IF;
 RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.stats_virtual_values_changed() FROM PUBLIC;
DROP TRIGGER IF EXISTS stats_virtual_value_insert ON public.estadisticas_jugador;
CREATE TRIGGER stats_virtual_value_insert AFTER INSERT ON public.estadisticas_jugador
 REFERENCING NEW TABLE AS new_stats FOR EACH STATEMENT EXECUTE FUNCTION public.stats_virtual_values_changed();
DROP TRIGGER IF EXISTS stats_virtual_value_update ON public.estadisticas_jugador;
CREATE TRIGGER stats_virtual_value_update AFTER UPDATE ON public.estadisticas_jugador
 REFERENCING OLD TABLE AS old_stats NEW TABLE AS new_stats FOR EACH STATEMENT EXECUTE FUNCTION public.stats_virtual_values_changed();
DROP TRIGGER IF EXISTS stats_virtual_value_delete ON public.estadisticas_jugador;
CREATE TRIGGER stats_virtual_value_delete AFTER DELETE ON public.estadisticas_jugador
 REFERENCING OLD TABLE AS old_stats FOR EACH STATEMENT EXECUTE FUNCTION public.stats_virtual_values_changed();

-- Publication marks the match as played after inserting statistics.
CREATE OR REPLACE FUNCTION public.match_virtual_values_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE affected uuid[];
BEGIN
 SELECT array_agg(DISTINCT s.jugador_id) INTO affected
 FROM public.estadisticas_jugador s JOIN new_matches m ON m.id = s.partido_id
 JOIN old_matches previous_match ON previous_match.id = m.id
 WHERE s.jugador_id IS NOT NULL AND
   (m.jugado, m.goles_local, m.goles_visitante, m.torneo_id, m.club_local_id, m.club_visitante_id, m.created_at)
   IS DISTINCT FROM
   (previous_match.jugado, previous_match.goles_local, previous_match.goles_visitante, previous_match.torneo_id, previous_match.club_local_id, previous_match.club_visitante_id, previous_match.created_at);
 IF cardinality(affected) > 0 THEN PERFORM public.refresh_player_virtual_values(affected); END IF;
 RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.match_virtual_values_changed() FROM PUBLIC;
DROP TRIGGER IF EXISTS match_virtual_value_update ON public.partidos;
CREATE TRIGGER match_virtual_value_update AFTER UPDATE ON public.partidos
 REFERENCING OLD TABLE AS old_matches NEW TABLE AS new_matches
 FOR EACH STATEMENT EXECUTE FUNCTION public.match_virtual_values_changed();

-- Backfill existing linked statistics and previously valued profiles.
SELECT public.refresh_player_virtual_values(array_agg(p.id))
FROM public.jugadores p WHERE p.valuacion IS NOT NULL OR EXISTS (
 SELECT 1 FROM public.estadisticas_jugador s WHERE s.jugador_id = p.id
);
COMMIT;
NOTIFY pgrst, 'reload schema';
