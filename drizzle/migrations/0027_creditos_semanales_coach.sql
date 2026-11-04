-- Créditos semanales de coach.
--
-- * Cada coach activa tiene weekly_class_credits clases por semana (2 por
--   default) para tomar clases del estudio desde "Mi perfil". No son
--   acumulables: la semana va de domingo a sábado (hora de Monterrey) y lo que
--   no se usa se pierde.
-- * La reserva es una reserva normal (mismo cupo, mismos lugares, misma
--   ventana de una semana) marcada con bookings.coach_credit. No mueve tokens
--   ni membresías y no pide waiver.
-- * Solo clases del estudio (crédito "general"), nunca el consultorio de
--   DorisFisio ni una clase que ella misma imparte.
-- * Cancelar antes de que empiece la clase devuelve el crédito de esa semana.
-- * Administración ve quién lo usa y quién no con coach_credit_usage.

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS coach_credit boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE public.staff_profiles ADD COLUMN IF NOT EXISTS weekly_class_credits integer NOT NULL DEFAULT 2;
--> statement-breakpoint
ALTER TABLE public.staff_profiles DROP CONSTRAINT IF EXISTS staff_profiles_weekly_class_credits_chk;
--> statement-breakpoint
ALTER TABLE public.staff_profiles ADD CONSTRAINT staff_profiles_weekly_class_credits_chk
  CHECK (weekly_class_credits >= 0 AND weekly_class_credits <= 14);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS bookings_coach_credit_idx ON public.bookings (user_id) WHERE coach_credit;
--> statement-breakpoint

-- Si una reserva cancelada con crédito de coach se vuelve a activar por otra
-- vía (reserva normal con tokens o membresía), deja de ser de coach.
CREATE OR REPLACE FUNCTION public.trg_coach_credit_flag()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(current_setting('laatu.coach_booking', true), '') = 'on' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.coach_credit := false;
  ELSIF NEW.coach_credit AND NEW.status = 'reservada' AND OLD.status IS DISTINCT FROM 'reservada' THEN
    NEW.coach_credit := false;
  END IF;
  RETURN NEW;
END;
$function$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS coach_credit_flag ON public.bookings;
--> statement-breakpoint
CREATE TRIGGER coach_credit_flag BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.trg_coach_credit_flag();
--> statement-breakpoint

-- Domingo (fecha local de Monterrey) de la semana de _at.
CREATE OR REPLACE FUNCTION public.studio_week_start(_at timestamptz)
RETURNS date
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT (_at AT TIME ZONE 'America/Monterrey')::date
         - extract(dow FROM (_at AT TIME ZONE 'America/Monterrey'))::int
$function$;
--> statement-breakpoint

-- Créditos de coach usados por una cuenta en la semana que empieza en _week.
CREATE OR REPLACE FUNCTION public.coach_credits_used(_user_id uuid, _week date)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT count(*)::int
    FROM public.bookings b JOIN public.classes c ON c.id = b.class_id
   WHERE b.user_id = _user_id AND b.coach_credit AND b.status = 'reservada'
     AND public.studio_week_start(c.starts_at) = _week
$function$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.coach_credits_used(uuid, date) FROM public, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.coach_credits_used(uuid, date) TO authenticated, service_role;
--> statement-breakpoint

-- Reserva de una coach con su crédito semanal.
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
   WHERE user_id = _uid AND active AND role = 'coach'
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
REVOKE EXECUTE ON FUNCTION public.coach_book_class(uuid, integer) FROM public, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.coach_book_class(uuid, integer) TO authenticated;
--> statement-breakpoint

-- La coach cancela su reserva de cortesía (sin cargos ni movimientos de
-- tokens); el crédito de esa semana vuelve a estar disponible.
CREATE OR REPLACE FUNCTION public.coach_cancel_booking(_booking_id uuid)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _b public.bookings; _start timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO _b FROM public.bookings WHERE id = _booking_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND'; END IF;
  IF _b.user_id IS DISTINCT FROM _uid OR NOT _b.coach_credit THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF _b.status <> 'reservada' THEN RAISE EXCEPTION 'ALREADY_CANCELLED'; END IF;
  SELECT starts_at INTO _start FROM public.classes WHERE id = _b.class_id;
  IF _start <= now() THEN RAISE EXCEPTION 'CLASS_PAST'; END IF;
  UPDATE public.bookings SET status = 'cancelada', seat_number = NULL WHERE id = _booking_id RETURNING * INTO _b;
  RETURN _b;
END;
$function$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.coach_cancel_booking(uuid) FROM public, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.coach_cancel_booking(uuid) TO authenticated;
--> statement-breakpoint

-- Lo que ve la coach: sus créditos de esta semana y la siguiente, y sus
-- reservas de cortesía próximas.
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
  SELECT * INTO _s FROM public.staff_profiles WHERE user_id = _uid AND active AND role = 'coach' LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'limit', _s.weekly_class_credits,
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
REVOKE EXECUTE ON FUNCTION public.coach_credit_status() FROM public, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.coach_credit_status() TO authenticated;
--> statement-breakpoint

-- Panel administrativo: uso de créditos por coach entre _from y _to
-- (fechas locales, _to incluida).
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
       WHERE s.role = 'coach'
      ) x
  ), '[]'::jsonb);
END;
$function$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.coach_credit_usage(date, date) FROM public, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.coach_credit_usage(date, date) TO authenticated;
