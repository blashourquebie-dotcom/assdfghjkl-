-- La publicación del resultado y sus estadísticas se confirma en una sola transacción.
ALTER TABLE public.partidos ADD COLUMN IF NOT EXISTS replay_url text;
CREATE OR REPLACE FUNCTION public.publish_approved_report(
  p_match_id uuid, p_home integer, p_away integer,
  p_report text, p_replay text, p_stats jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF p_home < 0 OR p_away < 0 THEN RAISE EXCEPTION 'Marcador inválido'; END IF;
  PERFORM id FROM public.partidos WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Partido inexistente'; END IF;
  DELETE FROM public.estadisticas_jugador WHERE partido_id = p_match_id;
  INSERT INTO public.estadisticas_jugador (
    partido_id, club_id, jugador_id, jugador_nombre, goles, asistencias,
    valla_invicta_segundos, goles_contra, es_mvp, es_destacado
  )
  SELECT p_match_id, club_id, jugador_id, jugador_nombre, goles, asistencias,
    valla_invicta_segundos, goles_contra, es_mvp, es_destacado
  FROM jsonb_to_recordset(p_stats) AS x(
    club_id uuid, jugador_id uuid, jugador_nombre text, goles integer,
    asistencias integer, valla_invicta_segundos integer, goles_contra integer,
    es_mvp boolean, es_destacado boolean
  );
  UPDATE public.partidos SET goles_local = p_home, goles_visitante = p_away,
    jugado = true, reporte_raw = p_report, replay_url = p_replay
  WHERE id = p_match_id;
  RETURN p_match_id;
END;
$$;
REVOKE ALL ON FUNCTION public.publish_approved_report(uuid, integer, integer, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_approved_report(uuid, integer, integer, text, text, jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
