BEGIN;
CREATE OR REPLACE FUNCTION public.configure_cup_byes(p_tournament uuid, p_clubs uuid[])
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE t public.torneos%ROWTYPE; slots integer := 2; needed integer;
BEGIN
  SELECT * INTO t FROM public.torneos WHERE id = p_tournament FOR UPDATE;
  IF NOT FOUND OR NOT (t.formato = 'copa' OR t.modo_copa) THEN RAISE EXCEPTION 'Copa inexistente'; END IF;
  IF t.cantidad_equipos < 2 OR t.cantidad_equipos > 32 THEN RAISE EXCEPTION 'Cantidad inválida'; END IF;
  IF EXISTS (SELECT 1 FROM public.partidos WHERE torneo_id = p_tournament) THEN RAISE EXCEPTION 'El fixture ya fue generado'; END IF;
  WHILE slots < t.cantidad_equipos LOOP slots := slots * 2; END LOOP;
  needed := slots - t.cantidad_equipos;
  IF p_clubs IS NULL OR cardinality(p_clubs) <> needed
     OR (SELECT count(DISTINCT id) FROM unnest(p_clubs) AS c(id)) <> needed
     OR EXISTS (SELECT 1 FROM unnest(p_clubs) AS c(id) WHERE NOT EXISTS
       (SELECT 1 FROM public.torneo_clubes tc WHERE tc.torneo_id = p_tournament AND tc.club_id = c.id))
  THEN RAISE EXCEPTION 'Pases libres inválidos'; END IF;
  UPDATE public.torneos SET configuracion = coalesce(configuracion, '{}'::jsonb) || jsonb_build_object('pases_libres', to_jsonb(p_clubs)) WHERE id = p_tournament;
END;
$$;
CREATE OR REPLACE FUNCTION public.append_configured_tournament_fixture(p_tournament uuid, p_expected_count integer, p_rows jsonb, p_expected_config jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE actual jsonb;
BEGIN
  SELECT configuracion INTO actual FROM public.torneos WHERE id = p_tournament FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Torneo inexistente'; END IF;
  IF coalesce(actual, '{}'::jsonb) IS DISTINCT FROM p_expected_config THEN RAISE EXCEPTION 'La configuración cambió. Volvé a generar.'; END IF;
  RETURN public.append_tournament_fixture(p_tournament, p_expected_count, p_rows);
END;
$$;
REVOKE ALL ON FUNCTION public.configure_cup_byes(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.append_configured_tournament_fixture(uuid, integer, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.configure_cup_byes(uuid, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.append_configured_tournament_fixture(uuid, integer, jsonb, jsonb) TO service_role;
COMMIT;
NOTIFY pgrst, 'reload schema';
