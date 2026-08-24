-- ============================================================================
-- Registrar (reservar) a un cliente directo desde el panel admin — para el
-- botón "Registrar miembro" dentro del detalle de una clase.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_book_class(_user_id uuid, _class_id uuid, _seat int DEFAULT NULL)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _c public.classes;
  _b public.bookings;
  _taken int;
  _bal int;
  _seat int := _seat;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.is_staff(auth.uid())) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  SELECT * INTO _c FROM public.classes WHERE id = _class_id AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'CLASS_NOT_FOUND'; END IF;
  SELECT count(*) INTO _taken FROM public.bookings WHERE class_id = _class_id AND status = 'reservada';
  IF _taken >= _c.capacity THEN RAISE EXCEPTION 'CLASS_FULL'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.bookings WHERE class_id = _class_id AND user_id = _user_id AND status = 'reservada'
  ) THEN
    RAISE EXCEPTION 'ALREADY_BOOKED';
  END IF;
  IF _seat IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.bookings WHERE class_id = _class_id AND seat_number = _seat AND status = 'reservada'
  ) THEN
    RAISE EXCEPTION 'SEAT_TAKEN';
  END IF;
  IF _seat IS NULL THEN
    SELECT MIN(s) INTO _seat FROM generate_series(1, _c.capacity) s
      WHERE s NOT IN (
        SELECT seat_number FROM public.bookings
        WHERE class_id = _class_id AND status = 'reservada' AND seat_number IS NOT NULL
      );
  END IF;
  SELECT public.token_balance(_user_id) INTO _bal;
  IF _bal < _c.tokens_cost THEN RAISE EXCEPTION 'INSUFFICIENT_TOKENS'; END IF;
  INSERT INTO public.bookings (user_id, class_id, tokens_spent, seat_number)
    VALUES (_user_id, _class_id, _c.tokens_cost, _seat)
    ON CONFLICT (user_id, class_id) DO UPDATE SET status = 'reservada', tokens_spent = _c.tokens_cost, seat_number = _seat
    RETURNING * INTO _b;
  INSERT INTO public.token_ledger (user_id, delta, reason, created_by)
    VALUES (_user_id, -_c.tokens_cost, 'Reserva registrada por staff', auth.uid());
  RETURN _b;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_book_class(uuid, uuid, int) TO authenticated;

-- Permite al staff editar y borrar clases directo (antes solo el rol admin
-- podía, vía "classes_admin_write"; el staff no tenía forma de crear,
-- editar ni borrar clases aunque la UI se lo permitiera).
GRANT UPDATE, DELETE ON public.classes TO authenticated;
DROP POLICY IF EXISTS "classes_staff_admin_write" ON public.classes;
CREATE POLICY "classes_staff_write" ON public.classes FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.is_staff(auth.uid()))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.is_staff(auth.uid()));

