-- Same tournament name is allowed across leagues, never within one league/modality.
BEGIN;
ALTER TABLE public.torneos DROP CONSTRAINT IF EXISTS torneos_modalidad_id_nombre_key;
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.torneos'::regclass AND conname = 'torneos_modalidad_tipo_nombre_key') THEN
  ALTER TABLE public.torneos ADD CONSTRAINT torneos_modalidad_tipo_nombre_key UNIQUE (modalidad_id, tipo, nombre);
 END IF;
END $$;
COMMIT;
NOTIFY pgrst, 'reload schema';
