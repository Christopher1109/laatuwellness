-- ============================================================================
-- Reserva con selección de lugar + lista de espera desde el lado del
-- cliente (hasta ahora solo existía desde el panel admin).
-- ============================================================================

-- Reemplaza book_class para aceptar un lugar opcional. Si no se manda
-- lugar, se asigna el primero libre automáticamente (compatibilidad con
-- llamadas viejas). Si el lugar pedido ya está tomado, truena con
-- SEAT_TAKEN para que el front pida elegir otro.
CREATE OR REPLACE FUNCTION public.book_class(_class_id uuid, _seat int DEFAULT NULL)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _c public.classes;
  _b public.bookings;
  _taken int;
  _bal int;
  _seat int := _seat;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO _c FROM public.classes WHERE id = _class_id AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'CLASS_NOT_FOUND'; END IF;
  IF _c.starts_at <= now() THEN RAISE EXCEPTION 'CLASS_PAST'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.waiver_signatures WHERE user_id = _uid) THEN
    RAISE EXCEPTION 'WAIVER_REQUIRED';
  END IF;
  SELECT count(*) INTO _taken FROM public.bookings WHERE class_id = _class_id AND status = 'reservada';
  IF _taken >= _c.capacity THEN RAISE EXCEPTION 'CLASS_FULL'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.bookings WHERE class_id = _class_id AND user_id = _uid AND status = 'reservada'
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
  SELECT public.token_balance(_uid) INTO _bal;
  IF _bal < _c.tokens_cost THEN RAISE EXCEPTION 'INSUFFICIENT_TOKENS'; END IF;
  INSERT INTO public.bookings (user_id, class_id, tokens_spent, seat_number)
    VALUES (_uid, _class_id, _c.tokens_cost, _seat)
    ON CONFLICT (user_id, class_id) DO UPDATE SET status = 'reservada', tokens_spent = _c.tokens_cost, seat_number = _seat
    RETURNING * INTO _b;
  INSERT INTO public.token_ledger (user_id, delta, reason) VALUES (_uid, -_c.tokens_cost, 'Reserva de clase');
  RETURN _b;
END;
$$;
GRANT EXECUTE ON FUNCTION public.book_class(uuid, int) TO authenticated;

-- Une a la lista de espera. Consume el crédito de inmediato (se reembolsa
-- si nunca hay espacio, vía refund_booking_credit desde el panel admin, o
-- si el cliente cancela su lugar en la lista con leave_waitlist).
CREATE OR REPLACE FUNCTION public.join_waitlist(_class_id uuid)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _c public.classes;
  _b public.bookings;
  _bal int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO _c FROM public.classes WHERE id = _class_id AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'CLASS_NOT_FOUND'; END IF;
  IF _c.starts_at <= now() THEN RAISE EXCEPTION 'CLASS_PAST'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.waiver_signatures WHERE user_id = _uid) THEN
    RAISE EXCEPTION 'WAIVER_REQUIRED';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.bookings WHERE class_id = _class_id AND user_id = _uid
      AND status IN ('reservada', 'lista_espera')
  ) THEN
    RAISE EXCEPTION 'ALREADY_BOOKED';
  END IF;
  SELECT public.token_balance(_uid) INTO _bal;
  IF _bal < _c.tokens_cost THEN RAISE EXCEPTION 'INSUFFICIENT_TOKENS'; END IF;
  INSERT INTO public.bookings (user_id, class_id, tokens_spent, status, waitlisted_at)
    VALUES (_uid, _class_id, _c.tokens_cost, 'lista_espera', now())
    ON CONFLICT (user_id, class_id) DO UPDATE SET status = 'lista_espera', tokens_spent = _c.tokens_cost, waitlisted_at = now()
    RETURNING * INTO _b;
  INSERT INTO public.token_ledger (user_id, delta, reason) VALUES (_uid, -_c.tokens_cost, 'Lista de espera');
  RETURN _b;
END;
$$;
GRANT EXECUTE ON FUNCTION public.join_waitlist(uuid) TO authenticated;

-- Salir de la lista de espera por decisión propia — reembolsa el crédito
-- (a diferencia de cancelar una reservación confirmada, que solo reembolsa
-- si faltan más de 12 horas).
CREATE OR REPLACE FUNCTION public.leave_waitlist(_booking_id uuid)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _b public.bookings;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO _b FROM public.bookings WHERE id = _booking_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND'; END IF;
  IF _b.user_id <> _uid AND NOT public.has_role(_uid, 'admin') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF _b.status <> 'lista_espera' THEN RAISE EXCEPTION 'NOT_WAITLISTED'; END IF;
  UPDATE public.bookings SET status = 'cancelada' WHERE id = _booking_id RETURNING * INTO _b;
  INSERT INTO public.token_ledger (user_id, delta, reason) VALUES (_b.user_id, _b.tokens_spent, 'Salió de lista de espera');
  RETURN _b;
END;
$$;
GRANT EXECUTE ON FUNCTION public.leave_waitlist(uuid) TO authenticated;

-- Cuenta cuántos lugares hay tomados y en lista de espera, para el front
-- público (no puede leer bookings de otros usuarios directo por RLS).
CREATE OR REPLACE FUNCTION public.class_waitlist_count(_class_id uuid)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int FROM public.bookings WHERE class_id = _class_id AND status = 'lista_espera'
$$;
GRANT EXECUTE ON FUNCTION public.class_waitlist_count(uuid) TO anon, authenticated;

-- Lugares ya tomados de una clase (solo números, no datos del cliente) para
-- que el front pueda pintar el mapa de asientos sin exponer quién es quién.
CREATE OR REPLACE FUNCTION public.class_taken_seats(_class_id uuid)
RETURNS int[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(array_agg(seat_number), '{}') FROM public.bookings
  WHERE class_id = _class_id AND status = 'reservada' AND seat_number IS NOT NULL
$$;
GRANT EXECUTE ON FUNCTION public.class_taken_seats(uuid) TO anon, authenticated;
