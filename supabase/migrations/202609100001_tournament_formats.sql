BEGIN;
ALTER TABLE public.torneos
  ADD COLUMN IF NOT EXISTS formato text NOT NULL DEFAULT 'liga',
  ADD COLUMN IF NOT EXISTS configuracion jsonb NOT NULL DEFAULT '{"ida_vuelta":false,"clasifican":2,"etiquetas":[]}';
UPDATE public.torneos SET formato = 'copa' WHERE modo_copa AND formato = 'liga';
ALTER TABLE public.partidos
  ADD COLUMN IF NOT EXISTS fase text,
  ADD COLUMN IF NOT EXISTS grupo text,
  ADD COLUMN IF NOT EXISTS ronda integer,
  ADD COLUMN IF NOT EXISTS llave integer,
  ADD COLUMN IF NOT EXISTS vuelta integer;
CREATE OR REPLACE FUNCTION public.append_tournament_fixture(p_tournament uuid, p_expected_count integer, p_rows jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE inserted_count integer;
BEGIN
  PERFORM id FROM public.torneos WHERE id = p_tournament FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Torneo inexistente'; END IF;
  IF (SELECT count(*) FROM public.partidos WHERE torneo_id = p_tournament) <> p_expected_count THEN
    RAISE EXCEPTION 'El fixture cambió. Volvé a consultar.';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN RAISE EXCEPTION 'Fixture vacío'; END IF;
  INSERT INTO public.partidos (torneo_id, fecha, club_local_id, club_visitante_id, jugado, fase, grupo, ronda, llave, vuelta)
  SELECT p_tournament, fecha, club_local_id, club_visitante_id, false, fase, grupo, ronda, llave, vuelta
  FROM jsonb_to_recordset(p_rows) AS x(fecha integer, club_local_id uuid, club_visitante_id uuid, fase text, grupo text, ronda integer, llave integer, vuelta integer);
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;
REVOKE ALL ON FUNCTION public.append_tournament_fixture(uuid, integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_tournament_fixture(uuid, integer, jsonb) TO service_role;
COMMIT;
NOTIFY pgrst, 'reload schema';
