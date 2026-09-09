-- ============================================================================
-- Rendimiento: la app hacía 2 llamadas (class_seats_taken +
-- class_waitlist_count) POR CADA clase visible del día — con 15 clases
-- son 30 idas y vueltas a la base solo para pintar la lista de horarios.
--
-- Esta función regresa la ocupación de TODAS las clases pedidas en una sola
-- llamada. class_seats_taken y class_waitlist_count se quedan igual (las
-- sigue usando book_class y otros lugares), esto es nada más una versión
-- "en lote" para listas.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.class_occupancy_batch(_class_ids uuid[])
RETURNS TABLE (class_id uuid, taken int, waitlisted int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    COALESCE((SELECT count(*)::int FROM public.bookings b
              WHERE b.class_id = c.id AND b.status = 'reservada'), 0),
    COALESCE((SELECT count(*)::int FROM public.bookings b
              WHERE b.class_id = c.id AND b.status = 'lista_espera'), 0)
  FROM unnest(_class_ids) AS c(id)
$$;
GRANT EXECUTE ON FUNCTION public.class_occupancy_batch(uuid[]) TO anon, authenticated;

-- Faltaba: coach_id se consulta seguido ahora (nómina por ocupación, perfil
-- del coach en admin, horario público del coach) y no tenía índice.
CREATE INDEX IF NOT EXISTS classes_coach_id_idx ON public.classes(coach_id);
