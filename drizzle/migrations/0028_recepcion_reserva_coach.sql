-- Recepción registra a una coach en una clase con su crédito semanal.
-- admin_book_class: si la persona es coach activa y la clase es del estudio
-- (crédito "general"), se usa su crédito de la semana (domingo a sábado) en
-- vez de tokens. Si ya usó sus clases de esa semana y no tiene tokens, avisa
-- con COACH_WEEKLY_LIMIT. Nunca en una clase que ella misma imparte.

CREATE OR REPLACE FUNCTION public.admin_book_class(_user_id uuid, _class_id uuid, _seat integer DEFAULT NULL::integer)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _c public.classes; _b public.bookings; _taken int; _seat int := _seat; _cost int; _need text; _kind text;
        _s public.staff_profiles; _coach_left boolean := false;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.is_staff(auth.uid())) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO _c FROM public.classes WHERE id = _class_id AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'CLASS_NOT_FOUND'; END IF;
  IF public.is_recovery(auth.uid()) AND NOT public.has_role(auth.uid(), 'admin')
     AND coalesce(_c.module_key, '') <> 'rehabilitacion' THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  SELECT count(*) INTO _taken FROM public.bookings WHERE class_id = _class_id AND status = 'reservada';
  IF _taken >= _c.capacity THEN RAISE EXCEPTION 'CLASS_FULL'; END IF;
  IF EXISTS (SELECT 1 FROM public.bookings WHERE class_id = _class_id AND user_id = _user_id AND status = 'reservada') THEN RAISE EXCEPTION 'ALREADY_BOOKED'; END IF;
  IF _seat IS NOT NULL AND EXISTS (SELECT 1 FROM public.bookings WHERE class_id = _class_id AND seat_number = _seat AND status = 'reservada') THEN RAISE EXCEPTION 'SEAT_TAKEN'; END IF;
  IF _seat IS NULL THEN
    SELECT MIN(s) INTO _seat FROM generate_series(1, _c.capacity) s
      WHERE s NOT IN (SELECT seat_number FROM public.bookings WHERE class_id = _class_id AND status = 'reservada' AND seat_number IS NOT NULL);
  END IF;
  _need := public.class_credit_kind(_class_id);

  -- Coach activa en una clase del estudio: crédito semanal de coach.
  SELECT * INTO _s FROM public.staff_profiles WHERE user_id = _user_id AND active AND role = 'coach' LIMIT 1;
  IF FOUND AND _need = 'general' THEN
    IF _c.coach_id = _s.id THEN RAISE EXCEPTION 'COACH_OWN_CLASS'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('coach_credit:' || _user_id::text, 0));
    _coach_left := public.coach_credits_used(_user_id, public.studio_week_start(_c.starts_at)) < _s.weekly_class_credits;
    IF _coach_left THEN
      PERFORM set_config('laatu.coach_booking', 'on', true);
      INSERT INTO public.bookings (user_id, class_id, tokens_spent, seat_number, credit_kind, coach_credit)
      VALUES (_user_id, _class_id, 0, _seat, 'general', true)
      ON CONFLICT (user_id, class_id) DO UPDATE
        SET status = 'reservada', tokens_spent = 0, seat_number = _seat, credit_kind = 'general',
            coach_credit = true, waitlisted_at = NULL
      RETURNING * INTO _b;
      PERFORM set_config('laatu.coach_booking', 'off', true);
      RETURN _b;
    END IF;
    -- Sin créditos de coach esa semana: solo si tiene tokens propios.
    IF public.token_balance_kind(_user_id, 'general') < greatest(_c.tokens_cost, 1) THEN
      RAISE EXCEPTION 'COACH_WEEKLY_LIMIT';
    END IF;
  END IF;

  IF _need = 'general' THEN
    _kind := 'general';
    _cost := CASE WHEN public.user_daily_class_limit(_user_id, _c.starts_at) IS NOT NULL THEN 0 ELSE _c.tokens_cost END;
  ELSE
    _kind := public.pick_credit_kind(_user_id, _need);
    _cost := greatest(_c.tokens_cost, 1);
  END IF;
  IF _cost > 0 AND public.token_balance_kind(_user_id, _kind) < _cost THEN
    RAISE EXCEPTION '%', public.insufficient_credit_code(_need);
  END IF;
  INSERT INTO public.bookings (user_id, class_id, tokens_spent, seat_number, credit_kind) VALUES (_user_id, _class_id, _cost, _seat, _kind)
    ON CONFLICT (user_id, class_id) DO UPDATE SET status = 'reservada', tokens_spent = _cost, seat_number = _seat, credit_kind = _kind
    RETURNING * INTO _b;
  IF _cost > 0 THEN
    INSERT INTO public.token_ledger (user_id, delta, reason, created_by, credit_kind) VALUES (_user_id, -_cost, 'Reserva registrada por staff', auth.uid(), _kind);
  END IF;
  RETURN _b;
END; $function$;
