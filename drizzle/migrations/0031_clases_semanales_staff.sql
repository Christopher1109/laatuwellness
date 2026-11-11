-- Clases semanales para staff seleccionado (no solo coaches).
--
-- * Las coaches activas siguen teniendo sus clases semanales como antes.
-- * Además, administración puede dar de alta a ciertos perfiles del staff
--   (staff_profiles.class_credits_enabled) desde "Clases de coaches"; esos
--   perfiles reciben las mismas clases semanales (weekly_class_credits, 2 por
--   default), con las mismas reglas: domingo a sábado, no acumulables, solo
--   clases del estudio.
-- * Las funciones de reserva, estado, uso y recepción aceptan coach O perfil
--   habilitado; el resto queda igual.

ALTER TABLE public.staff_profiles ADD COLUMN IF NOT EXISTS class_credits_enabled boolean NOT NULL DEFAULT false;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.coach_book_class(_class_id uuid, _seat integer DEFAULT NULL)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _s public.staff_profiles;
  _c public.classes;
  _b public.bookings;
  _taken int;
  _seat int := _seat;
  _week date;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO _s FROM public.staff_profiles
   WHERE user_id = _uid AND active AND (role = 'coach' OR class_credits_enabled)
   LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'COACH_ONLY'; END IF;

  SELECT * INTO _c FROM public.classes WHERE id = _class_id AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'CLASS_NOT_FOUND'; END IF;
  IF _c.starts_at <= now() THEN RAISE EXCEPTION 'CLASS_PAST'; END IF;
  IF _c.starts_at >= public.booking_window_end() THEN RAISE EXCEPTION 'BOOKING_WINDOW'; END IF;
  IF public.class_credit_kind(_class_id) <> 'general' THEN RAISE EXCEPTION 'COACH_CLASS_NOT_ALLOWED'; END IF;
  IF _c.coach_id = _s.id THEN RAISE EXCEPTION 'COACH_OWN_CLASS'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('coach_credit:' || _uid::text, 0));
  _week := public.studio_week_start(_c.starts_at);
  IF public.coach_credits_used(_uid, _week) >= _s.weekly_class_credits THEN
    RAISE EXCEPTION 'COACH_WEEKLY_LIMIT';
  END IF;

  SELECT count(*) INTO _taken FROM public.bookings WHERE class_id = _class_id AND status = 'reservada';
  IF _taken >= _c.capacity THEN RAISE EXCEPTION 'CLASS_FULL'; END IF;
  IF EXISTS (SELECT 1 FROM public.bookings WHERE class_id = _class_id AND user_id = _uid AND status = 'reservada') THEN
    RAISE EXCEPTION 'ALREADY_BOOKED';
  END IF;
  IF _seat IS NOT NULL AND (_seat < 1 OR _seat > _c.capacity) THEN RAISE EXCEPTION 'SEAT_TAKEN'; END IF;
  IF _seat IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.bookings WHERE class_id = _class_id AND seat_number = _seat AND status = 'reservada'
  ) THEN RAISE EXCEPTION 'SEAT_TAKEN'; END IF;
  IF _seat IS NULL THEN
    SELECT min(s) INTO _seat FROM generate_series(1, _c.capacity) s
     WHERE s NOT IN (SELECT seat_number FROM public.bookings
                      WHERE class_id = _class_id AND status = 'reservada' AND seat_number IS NOT NULL);
  END IF;

  PERFORM set_config('laatu.coach_booking', 'on', true);
  INSERT INTO public.bookings (user_id, class_id, tokens_spent, seat_number, credit_kind, coach_credit)
  VALUES (_uid, _class_id, 0, _seat, 'general', true)
  ON CONFLICT (user_id, class_id) DO UPDATE
    SET status = 'reservada', tokens_spent = 0, seat_number = _seat, credit_kind = 'general',
        coach_credit = true, waitlisted_at = NULL
  RETURNING * INTO _b;
  PERFORM set_config('laatu.coach_booking', 'off', true);
  RETURN _b;
END;
$function$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.coach_credit_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _s public.staff_profiles; _week date := public.studio_week_start(now());
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO _s FROM public.staff_profiles WHERE user_id = _uid AND active AND (role = 'coach' OR class_credits_enabled) LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'limit', _s.weekly_class_credits,
    'is_coach', _s.role = 'coach',
    'week_start', _week,
    'used_this_week', public.coach_credits_used(_uid, _week),
    'next_week_start', _week + 7,
    'used_next_week', public.coach_credits_used(_uid, _week + 7),
    'bookings', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'booking_id', b.id, 'class_id', c.id, 'starts_at', c.starts_at,
               'duration_min', c.duration_min, 'seat_number', b.seat_number,
               'module_key', c.module_key, 'class_name', ct.name,
               'coach', CASE WHEN c.is_tbd THEN NULL ELSE coalesce(nullif(c.instructor, ''), c.room) END)
             ORDER BY c.starts_at)
        FROM public.bookings b
        JOIN public.classes c ON c.id = b.class_id
        LEFT JOIN public.class_types ct ON ct.id = c.class_type_id
       WHERE b.user_id = _uid AND b.coach_credit AND b.status = 'reservada'
         AND c.starts_at + make_interval(mins => c.duration_min) > now()
    ), '[]'::jsonb)
  );
END;
$function$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.coach_credit_usage(_from date, _to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _week date := public.studio_week_start(now());
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(), 'admin')
     OR (public.has_role(auth.uid(), 'staff') AND public.is_staff(auth.uid()))) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(row ORDER BY (row->>'full_name'))
      FROM (
        SELECT jsonb_build_object(
          'staff_id', s.id,
          'full_name', s.full_name,
          'role', s.role::text,
          'active', s.active,
          'has_account', s.user_id IS NOT NULL,
          'color', s.color,
          'photo_url', s.photo_url,
          'weekly_limit', s.weekly_class_credits,
          'used_this_week', CASE WHEN s.user_id IS NULL THEN 0 ELSE public.coach_credits_used(s.user_id, _week) END,
          'last_used_at', (
            SELECT max(c.starts_at) FROM public.bookings b JOIN public.classes c ON c.id = b.class_id
             WHERE b.user_id = s.user_id AND b.coach_credit AND b.status = 'reservada' AND c.starts_at <= now()),
          'bookings', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                     'booking_id', b.id, 'starts_at', c.starts_at, 'module_key', c.module_key,
                     'class_name', ct.name, 'coach', c.instructor, 'status', b.status,
                     'checkin_status', ci.status)
                   ORDER BY c.starts_at)
              FROM public.bookings b
              JOIN public.classes c ON c.id = b.class_id
              LEFT JOIN public.class_types ct ON ct.id = c.class_type_id
              LEFT JOIN public.check_ins ci ON ci.booking_id = b.id
             WHERE b.user_id = s.user_id AND b.coach_credit
               AND (c.starts_at AT TIME ZONE 'America/Monterrey')::date BETWEEN _from AND _to
          ), '[]'::jsonb)
        ) AS row
        FROM public.staff_profiles s
       WHERE s.role = 'coach' OR s.class_credits_enabled
      ) x
  ), '[]'::jsonb);
END;
$function$;
--> statement-breakpoint

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
  SELECT * INTO _s FROM public.staff_profiles WHERE user_id = _user_id AND active AND (role = 'coach' OR class_credits_enabled) LIMIT 1;
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
