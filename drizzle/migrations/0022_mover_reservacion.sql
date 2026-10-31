-- Mover una reservación a otra clase desde el panel (por ejemplo, cuando se
-- cambia el horario y alguien ya había reservado). La persona conserva lo que
-- pagó: si reservó con crédito no se le cobra otro, y si fue con membresía
-- sigue contando como su clase de ese día. No se puede mover a una clase llena,
-- pasada, de otro tipo de crédito ni a una que ya tenga reservada.
CREATE OR REPLACE FUNCTION public.move_booking(_booking_id uuid, _target_class_id uuid)
 RETURNS bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _b public.bookings;
  _from public.classes;
  _to public.classes;
  _taken int;
  _seat int;
  _need text;
  _limit int;
  _count int;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.is_staff(auth.uid())) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  SELECT * INTO _b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND'; END IF;
  IF _b.status <> 'reservada' THEN RAISE EXCEPTION 'BOOKING_NOT_ACTIVE'; END IF;
  IF _b.class_id = _target_class_id THEN RAISE EXCEPTION 'SAME_CLASS'; END IF;
  SELECT * INTO _from FROM public.classes WHERE id = _b.class_id;
  SELECT * INTO _to FROM public.classes WHERE id = _target_class_id AND active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CLASS_NOT_FOUND'; END IF;
  IF _to.starts_at <= now() THEN RAISE EXCEPTION 'CLASS_PAST'; END IF;
  IF public.is_recovery(auth.uid()) AND NOT public.has_role(auth.uid(), 'admin')
     AND (coalesce(_to.module_key, '') <> 'rehabilitacion' OR coalesce(_from.module_key, '') <> 'rehabilitacion') THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  -- El crédito que ya se usó debe servir en la clase nueva.
  _need := public.class_credit_kind(_target_class_id);
  IF _b.tokens_spent > 0 AND NOT (
       _need = _b.credit_kind OR (_need = 'doris_any' AND _b.credit_kind IN ('doris_ul', 'doris_fb'))
     ) THEN
    RAISE EXCEPTION 'MOVE_WRONG_CREDIT_KIND';
  END IF;
  IF _b.tokens_spent = 0 AND _need <> 'general' THEN
    RAISE EXCEPTION 'MOVE_WRONG_CREDIT_KIND';
  END IF;

  IF EXISTS (SELECT 1 FROM public.bookings WHERE class_id = _target_class_id AND user_id = _b.user_id AND status IN ('reservada', 'lista_espera')) THEN
    RAISE EXCEPTION 'ALREADY_BOOKED';
  END IF;
  SELECT count(*) INTO _taken FROM public.bookings WHERE class_id = _target_class_id AND status = 'reservada';
  IF _taken >= _to.capacity THEN RAISE EXCEPTION 'CLASS_FULL'; END IF;

  -- Membresía: si cambia de día, respetar el límite de clases de ese día.
  IF _b.tokens_spent = 0 AND (_to.starts_at AT TIME ZONE 'America/Monterrey')::date
       <> (_from.starts_at AT TIME ZONE 'America/Monterrey')::date THEN
    _limit := public.user_daily_class_limit(_b.user_id, _to.starts_at);
    IF _limit IS NOT NULL THEN
      SELECT count(*) INTO _count FROM public.bookings b JOIN public.classes c ON c.id = b.class_id
       WHERE b.user_id = _b.user_id AND b.status = 'reservada' AND b.tokens_spent = 0 AND b.id <> _b.id
         AND (c.starts_at AT TIME ZONE 'America/Monterrey')::date = (_to.starts_at AT TIME ZONE 'America/Monterrey')::date;
      IF _count >= _limit THEN RAISE EXCEPTION 'DAILY_LIMIT_REACHED'; END IF;
    END IF;
  END IF;

  SELECT MIN(s) INTO _seat FROM generate_series(1, _to.capacity) s
    WHERE s NOT IN (SELECT seat_number FROM public.bookings WHERE class_id = _target_class_id AND status = 'reservada' AND seat_number IS NOT NULL);

  -- Si la persona ya tuvo antes una reservación cancelada en la clase destino,
  -- se reactiva esa fila (con lo que pagó en la original) y la original queda
  -- cancelada sin devolución, porque el pago se pasó a la nueva.
  IF EXISTS (SELECT 1 FROM public.bookings WHERE class_id = _target_class_id AND user_id = _b.user_id) THEN
    UPDATE public.bookings SET status = 'cancelada', seat_number = NULL, tokens_spent = 0 WHERE id = _booking_id;
    UPDATE public.bookings
       SET status = 'reservada', tokens_spent = _b.tokens_spent, credit_kind = _b.credit_kind,
           seat_number = _seat, waitlisted_at = NULL
     WHERE class_id = _target_class_id AND user_id = _b.user_id
     RETURNING * INTO _b;
  ELSE
    UPDATE public.bookings
       SET class_id = _target_class_id, seat_number = _seat
     WHERE id = _booking_id
     RETURNING * INTO _b;
  END IF;
  RETURN _b;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.move_booking(uuid, uuid) FROM anon;
