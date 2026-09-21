-- Ejecutar en el SQL Editor del mismo proyecto Supabase usado por el bot.
ALTER TABLE public.jugadores ADD COLUMN IF NOT EXISTS valuacion bigint;
NOTIFY pgrst, 'reload schema';
