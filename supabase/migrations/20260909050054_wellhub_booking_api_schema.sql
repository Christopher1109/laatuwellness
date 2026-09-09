-- ============================================================================
-- Integración real con Wellhub (API de reservas), separada del modelo
-- manual de Fitpass/TotalPass (que se queda como está, con los planes de
-- $0 "Convenio" que ya existen).
--
-- Las reservas de Wellhub NO se guardan en public.bookings (esa tabla
-- exige un usuario con cuenta en Läätu, y un miembro de Wellhub no
-- necesariamente tiene una). Se guardan en su propia tabla, y el cupo se
-- cuenta sumando las dos fuentes.
-- ============================================================================

-- Por clase: cuántos lugares se le ofrecen a Wellhub (null = no se ofrece
-- esta clase en Wellhub todavía) y el ID del "slot" que Wellhub nos
-- devuelve cuando le mandamos la clase.
ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS wellhub_max_spots int;
ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS wellhub_slot_id text;

CREATE TABLE IF NOT EXISTS public.wellhub_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  wellhub_booking_id text NOT NULL UNIQUE,
  member_name text,
  member_email text,
  status text NOT NULL DEFAULT 'reservada', -- reservada | cancelada
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wellhub_bookings_class_idx ON public.wellhub_bookings(class_id);
GRANT SELECT ON public.wellhub_bookings TO authenticated;
GRANT ALL ON public.wellhub_bookings TO service_role;
ALTER TABLE public.wellhub_bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wellhub_bookings_staff_select" ON public.wellhub_bookings;
CREATE POLICY "wellhub_bookings_staff_select" ON public.wellhub_bookings FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.is_staff(auth.uid()));

-- Ocupación real de una clase = reservas directas (bookings) + reservas de
-- Wellhub. Se usa en vez de class_seats_taken en los lugares que ya
-- consideran Wellhub (el resto sigue igual, sin romper nada existente).
CREATE OR REPLACE FUNCTION public.class_total_occupancy(_class_id uuid)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT count(*)::int FROM public.bookings WHERE class_id = _class_id AND status = 'reservada')
    +
    (SELECT count(*)::int FROM public.wellhub_bookings WHERE class_id = _class_id AND status = 'reservada')
$$;
GRANT EXECUTE ON FUNCTION public.class_total_occupancy(uuid) TO anon, authenticated;

-- Crea (o reconcilia, si el webhook se reintenta) una reserva de Wellhub.
-- Respeta el cupo máximo asignado a Wellhub en esa clase.
CREATE OR REPLACE FUNCTION public.fulfill_wellhub_booking(
  _class_id uuid,
  _wellhub_booking_id text,
  _member_name text,
  _member_email text
)
RETURNS TABLE (booking_id uuid, accepted boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _existing uuid;
  _max int;
  _taken int;
  _new_id uuid;
BEGIN
  SELECT id INTO _existing FROM public.wellhub_bookings WHERE wellhub_booking_id = _wellhub_booking_id;
  IF FOUND THEN
    RETURN QUERY SELECT _existing, true;
    RETURN;
  END IF;

  SELECT wellhub_max_spots INTO _max FROM public.classes WHERE id = _class_id;
  IF _max IS NULL THEN
    -- Esta clase no está habilitada para Wellhub; no debería pasar si el
    -- push de horarios está bien hecho, pero por seguridad se rechaza.
    RETURN QUERY SELECT NULL::uuid, false;
    RETURN;
  END IF;

  SELECT public.class_total_occupancy(_class_id) INTO _taken;
  IF _taken >= _max THEN
    RETURN QUERY SELECT NULL::uuid, false;
    RETURN;
  END IF;

  INSERT INTO public.wellhub_bookings (class_id, wellhub_booking_id, member_name, member_email)
    VALUES (_class_id, _wellhub_booking_id, _member_name, _member_email)
    RETURNING id INTO _new_id;

  RETURN QUERY SELECT _new_id, true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fulfill_wellhub_booking(uuid, text, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_wellhub_booking(uuid, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.cancel_wellhub_booking(_wellhub_booking_id text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.wellhub_bookings SET status = 'cancelada' WHERE wellhub_booking_id = _wellhub_booking_id;
$$;
REVOKE EXECUTE ON FUNCTION public.cancel_wellhub_booking(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_wellhub_booking(text) TO service_role;
