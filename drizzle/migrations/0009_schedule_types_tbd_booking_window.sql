-- Horarios: tipo de clase por bloque, clases "por definir", hora real distinta
-- a la del renglón (ej. 8:15), sustituciones de coach que no se pierden al
-- republicar, colores de coach, ventana de reserva de 7 días y lista de
-- reservas para el perfil del coach. Todo es idempotente.

ALTER TABLE public.schedule_templates ADD COLUMN IF NOT EXISTS class_type_id uuid REFERENCES public.class_types(id) ON DELETE SET NULL;
ALTER TABLE public.schedule_templates ADD COLUMN IF NOT EXISTS is_tbd boolean NOT NULL DEFAULT false;
ALTER TABLE public.schedule_templates ADD COLUMN IF NOT EXISTS actual_start time;
ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS is_tbd boolean NOT NULL DEFAULT false;
ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS manual_override boolean NOT NULL DEFAULT false;
ALTER TABLE public.class_types ADD COLUMN IF NOT EXISTS default_capacity integer;
ALTER TABLE public.staff_profiles ADD COLUMN IF NOT EXISTS color text;

-- Fin de la ventana de reserva: hoy + 7 días completos (hora de Monterrey).
-- Lunes 26 → se ve y se reserva hasta el lunes 2 inclusive.
CREATE OR REPLACE FUNCTION public.booking_window_end()
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT (((now() AT TIME ZONE 'America/Monterrey')::date + 8)::timestamp) AT TIME ZONE 'America/Monterrey'
$function$;

DROP POLICY IF EXISTS classes_public_read ON public.classes;
CREATE POLICY classes_public_read ON public.classes FOR SELECT TO anon, authenticated
  USING (
    (active AND (starts_at < public.booking_window_end() OR public.is_staff(auth.uid())))
    OR public.has_role(auth.uid(), 'admin'::app_role)
  );

CREATE OR REPLACE FUNCTION public.book_class(_class_id uuid, _seat integer DEFAULT NULL::integer, _use_credits boolean DEFAULT false)
 RETURNS bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _c public.classes; _b public.bookings; _taken int; _bal int; _seat int := _seat; _cost int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO _c FROM public.classes WHERE id = _class_id AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'CLASS_NOT_FOUND'; END IF;
  IF _c.starts_at <= now() THEN RAISE EXCEPTION 'CLASS_PAST'; END IF;
  IF _c.starts_at >= public.booking_window_end()
     AND NOT (public.is_staff(_uid) OR public.has_role(_uid, 'admin')) THEN
    RAISE EXCEPTION 'BOOKING_WINDOW';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.waiver_signatures WHERE user_id = _uid) THEN RAISE EXCEPTION 'WAIVER_REQUIRED'; END IF;
  SELECT count(*) INTO _taken FROM public.bookings WHERE class_id = _class_id AND status = 'reservada';
  IF _taken >= _c.capacity THEN RAISE EXCEPTION 'CLASS_FULL'; END IF;
  IF EXISTS (SELECT 1 FROM public.bookings WHERE class_id = _class_id AND user_id = _uid AND status = 'reservada') THEN RAISE EXCEPTION 'ALREADY_BOOKED'; END IF;
  IF _seat IS NOT NULL AND EXISTS (SELECT 1 FROM public.bookings WHERE class_id = _class_id AND seat_number = _seat AND status = 'reservada') THEN RAISE EXCEPTION 'SEAT_TAKEN'; END IF;
  IF _seat IS NULL THEN
    SELECT MIN(s) INTO _seat FROM generate_series(1, _c.capacity) s
      WHERE s NOT IN (SELECT seat_number FROM public.bookings WHERE class_id = _class_id AND status = 'reservada' AND seat_number IS NOT NULL);
  END IF;
  _cost := CASE WHEN NOT _use_credits AND public.user_daily_class_limit(_uid, _c.starts_at) IS NOT NULL THEN 0
                WHEN _use_credits THEN greatest(_c.tokens_cost, 1) ELSE _c.tokens_cost END;
  SELECT public.token_balance(_uid) INTO _bal;
  IF _bal < _cost THEN RAISE EXCEPTION 'INSUFFICIENT_TOKENS'; END IF;
  INSERT INTO public.bookings (user_id, class_id, tokens_spent, seat_number) VALUES (_uid, _class_id, _cost, _seat)
    ON CONFLICT (user_id, class_id) DO UPDATE SET status = 'reservada', tokens_spent = _cost, seat_number = _seat
    RETURNING * INTO _b;
  IF _cost > 0 THEN
    INSERT INTO public.token_ledger (user_id, delta, reason) VALUES (_uid, -_cost, 'Reserva de clase');
  END IF;
  RETURN _b;
END; $function$;

CREATE OR REPLACE FUNCTION public.join_waitlist(_class_id uuid)
 RETURNS bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF _c.starts_at >= public.booking_window_end()
     AND NOT (public.is_staff(_uid) OR public.has_role(_uid, 'admin')) THEN
    RAISE EXCEPTION 'BOOKING_WINDOW';
  END IF;
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
$function$;

CREATE OR REPLACE FUNCTION public.coach_public_schedule(_coach_name text, _days integer DEFAULT 7)
 RETURNS TABLE(id uuid, starts_at timestamp with time zone, room text, module_key text, capacity integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT c.id, c.starts_at, c.room, c.module_key, c.capacity
  FROM public.classes c
  JOIN public.staff_profiles s ON s.id = c.coach_id
  JOIN public.site_modules m ON m.key = c.module_key AND m.enabled
  WHERE c.active
    AND c.starts_at > now()
    AND c.starts_at < LEAST(now() + make_interval(days => COALESCE(_days, 7)), public.booking_window_end())
    AND (s.full_name ILIKE _coach_name OR c.instructor ILIKE _coach_name)
  ORDER BY c.starts_at
$function$;

-- Publica el patrón del mes en clases reales. Corrige el desfase de zona
-- horaria (las clases de la tarde-noche caían en el día siguiente en UTC y
-- se cruzaban coaches entre días), usa el tipo de clase, los bloques "por
-- definir", la hora real del bloque y respeta las sustituciones hechas a mano
-- en una clase puntual (manual_override).
CREATE OR REPLACE FUNCTION public.publish_schedule_range(_module_key text, _from date, _to date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tz constant text := 'America/Monterrey';
  v_day date;
  v_t record;
  v_touched integer := 0;
  v_class public.classes;
  v_waiting integer;
  v_reserved integer;
  v_coach uuid;
  v_coach_name text;
  v_time time;
  v_start timestamptz;
  v_label text;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR (public.has_role(auth.uid(), 'staff') AND public.is_staff(auth.uid()))) THEN
    RAISE EXCEPTION 'Solo administración puede actualizar la programación';
  END IF;

  FOR v_day IN SELECT generate_series(_from, _to, interval '1 day')::date LOOP
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.schedule_blackouts b
      WHERE b.module_key = _module_key AND b.day = v_day
    );

    FOR v_t IN
      SELECT * FROM public.schedule_templates
      WHERE module_key = _module_key
        AND month = date_trunc('month', v_day)::date
        AND active = true
        AND weekday = EXTRACT(ISODOW FROM v_day)::int - 1
    LOOP
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM public.schedule_slot_blocks sb
        WHERE sb.module_key = _module_key AND sb.day = v_day
          AND sb.start_time = v_t.start_time
      );

      v_time := coalesce(v_t.actual_start, v_t.start_time);
      v_start := (v_day + v_time) AT TIME ZONE v_tz;

      v_coach := CASE WHEN v_t.is_tbd THEN NULL ELSE v_t.coach_id END;
      IF v_t.is_rotation THEN
        SELECT g.coach_id INTO v_coach FROM public.get_weekend_coach(v_day) g LIMIT 1;
      END IF;
      v_coach_name := NULL;
      IF v_coach IS NOT NULL THEN
        SELECT full_name INTO v_coach_name FROM public.staff_profiles WHERE id = v_coach;
      END IF;
      v_label := coalesce(v_coach_name, CASE WHEN v_t.is_rotation THEN 'Rotación' ELSE 'Coach por anunciar' END);

      SELECT * INTO v_class FROM public.classes c
      WHERE c.module_key = _module_key
        AND (c.starts_at AT TIME ZONE v_tz)::date = v_day
        AND (c.starts_at AT TIME ZONE v_tz)::time IN (v_time, v_t.start_time)
      ORDER BY (c.starts_at = v_start) DESC, c.active DESC, c.created_at, c.id
      LIMIT 1;

      IF NOT FOUND THEN
        INSERT INTO public.classes (module_key, class_type_id, room, instructor, starts_at, duration_min, capacity, tokens_cost, active, coach_id, is_tbd)
        VALUES (_module_key, v_t.class_type_id, v_t.room, v_label, v_start, v_t.duration_min, v_t.capacity, 1, true, v_coach, v_coach IS NULL);
      ELSE
        SELECT count(*) FILTER (WHERE status = 'reservada'), count(*) FILTER (WHERE status IN ('reservada', 'lista_espera'))
          INTO v_reserved, v_waiting
          FROM public.bookings WHERE class_id = v_class.id;
        IF v_class.manual_override THEN
          UPDATE public.classes
          SET active = true,
              starts_at = CASE WHEN v_waiting = 0 THEN v_start ELSE starts_at END
          WHERE id = v_class.id;
        ELSE
          UPDATE public.classes
          SET coach_id = v_coach,
              instructor = v_label,
              is_tbd = v_coach IS NULL,
              class_type_id = v_t.class_type_id,
              room = v_t.room,
              duration_min = v_t.duration_min,
              capacity = GREATEST(v_t.capacity, v_reserved),
              starts_at = CASE WHEN v_waiting = 0 THEN v_start ELSE starts_at END,
              active = true
          WHERE id = v_class.id;
        END IF;
      END IF;
      v_touched := v_touched + 1;
    END LOOP;
  END LOOP;

  -- Se apagan (sin borrar) las clases del rango que ya no están en el patrón,
  -- las de días cerrados o bloques bloqueados y los duplicados del mismo
  -- horario; nunca las que tienen reservas o lista de espera.
  UPDATE public.classes c
  SET active = false
  WHERE c.module_key = _module_key
    AND c.active
    AND (c.starts_at AT TIME ZONE v_tz)::date BETWEEN _from AND _to
    AND NOT EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.class_id = c.id AND b.status IN ('reservada', 'lista_espera')
    )
    AND (
      EXISTS (
        SELECT 1 FROM public.schedule_blackouts b
        WHERE b.module_key = _module_key AND b.day = (c.starts_at AT TIME ZONE v_tz)::date
      )
      OR NOT EXISTS (
        SELECT 1 FROM public.schedule_templates t
        WHERE t.module_key = _module_key
          AND t.active = true
          AND t.month = date_trunc('month', (c.starts_at AT TIME ZONE v_tz)::date)::date
          AND t.weekday = EXTRACT(ISODOW FROM (c.starts_at AT TIME ZONE v_tz)::date)::int - 1
          AND coalesce(t.actual_start, t.start_time) = (c.starts_at AT TIME ZONE v_tz)::time
          AND NOT EXISTS (
            SELECT 1 FROM public.schedule_slot_blocks sb
            WHERE sb.module_key = _module_key
              AND sb.day = (c.starts_at AT TIME ZONE v_tz)::date
              AND sb.start_time = t.start_time
          )
      )
      OR EXISTS (
        SELECT 1 FROM public.classes c2
        WHERE c2.module_key = c.module_key
          AND c2.starts_at = c.starts_at
          AND c2.active
          AND c2.id <> c.id
          AND (c2.created_at < c.created_at OR (c2.created_at = c.created_at AND c2.id < c.id))
      )
    );

  RETURN v_touched;
END;
$function$;

-- Bloquear un bloque de un solo día también encuentra la clase cuando el
-- bloque tiene hora real distinta (ej. renglón 8:00, clase 8:15).
CREATE OR REPLACE FUNCTION public.set_schedule_slot_block(_module_key text, _day date, _start_time text, _blocked boolean)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _time time := _start_time::time;
  _real time;
  _class_id uuid;
  _b record;
  _cancelled int := 0;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR (public.has_role(auth.uid(), 'staff') AND public.is_staff(auth.uid()))) THEN
    RAISE EXCEPTION 'Solo administración puede bloquear horarios';
  END IF;

  SELECT t.actual_start INTO _real FROM public.schedule_templates t
  WHERE t.module_key = _module_key
    AND t.month = date_trunc('month', _day)::date
    AND t.weekday = EXTRACT(ISODOW FROM _day)::int - 1
    AND t.start_time = _time
  LIMIT 1;
  _real := coalesce(_real, _time);

  SELECT id INTO _class_id FROM public.classes
  WHERE module_key = _module_key
    AND (starts_at AT TIME ZONE 'America/Monterrey')::date = _day
    AND (starts_at AT TIME ZONE 'America/Monterrey')::time IN (_real, _time)
  ORDER BY active DESC, created_at
  LIMIT 1;

  IF _blocked THEN
    INSERT INTO public.schedule_slot_blocks (module_key, day, start_time, created_by)
      VALUES (_module_key, _day, _time, auth.uid())
      ON CONFLICT (module_key, day, start_time) DO NOTHING;

    IF _class_id IS NOT NULL THEN
      FOR _b IN
        SELECT id, user_id, tokens_spent FROM public.bookings
        WHERE class_id = _class_id AND status IN ('reservada', 'lista_espera')
      LOOP
        UPDATE public.bookings SET status = 'cancelada' WHERE id = _b.id;
        IF _b.tokens_spent > 0 THEN
          INSERT INTO public.token_ledger (user_id, delta, reason, created_by)
            VALUES (_b.user_id, _b.tokens_spent, 'Clase cancelada por el estudio', auth.uid());
        END IF;
        _cancelled := _cancelled + 1;
      END LOOP;
      UPDATE public.classes SET active = false WHERE id = _class_id;
    END IF;
  ELSE
    DELETE FROM public.schedule_slot_blocks
      WHERE module_key = _module_key AND day = _day AND start_time = _time;
    IF _class_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.schedule_blackouts WHERE module_key = _module_key AND day = _day
    ) THEN
      UPDATE public.classes SET active = true WHERE id = _class_id;
    END IF;
  END IF;

  RETURN _cancelled;
END;
$function$;

CREATE OR REPLACE FUNCTION public.copy_schedule_month(_module_key text, _from_month date, _to_month date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR (public.has_role(auth.uid(), 'staff') AND public.is_staff(auth.uid()))) THEN
    RAISE EXCEPTION 'Solo administración puede copiar la programación';
  END IF;

  INSERT INTO public.schedule_templates (module_key, weekday, start_time, duration_min, room, capacity, coach_id, is_rotation, active, month, class_type_id, is_tbd, actual_start)
  SELECT module_key, weekday, start_time, duration_min, room, capacity, coach_id, is_rotation, active,
         date_trunc('month', _to_month)::date, class_type_id, is_tbd, actual_start
  FROM public.schedule_templates
  WHERE module_key = _module_key
    AND month = date_trunc('month', _from_month)::date
  ON CONFLICT (module_key, weekday, start_time, month) DO UPDATE
  SET coach_id = EXCLUDED.coach_id,
      is_rotation = EXCLUDED.is_rotation,
      active = EXCLUDED.active,
      duration_min = EXCLUDED.duration_min,
      room = EXCLUDED.room,
      capacity = EXCLUDED.capacity,
      class_type_id = EXCLUDED.class_type_id,
      is_tbd = EXCLUDED.is_tbd,
      actual_start = EXCLUDED.actual_start;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

-- Lista de la clase para el perfil del coach (solo sus propias clases) y
-- para staff/admin. Devuelve nombres, no correos ni teléfonos.
CREATE OR REPLACE FUNCTION public.coach_class_roster(_class_id uuid)
 RETURNS TABLE(booking_id uuid, full_name text, status text, seat_number integer, checked_in boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin')
    OR (public.has_role(auth.uid(), 'staff') AND public.is_staff(auth.uid()))
    OR EXISTS (
      SELECT 1 FROM public.classes c
      JOIN public.staff_profiles s ON s.id = c.coach_id
      WHERE c.id = _class_id AND s.user_id = auth.uid() AND s.active
    )
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  RETURN QUERY
  SELECT b.id,
         coalesce(nullif(p.full_name, ''), split_part(coalesce(p.email, ''), '@', 1))::text,
         b.status::text,
         b.seat_number,
         EXISTS (SELECT 1 FROM public.check_ins ci WHERE ci.booking_id = b.id AND ci.status <> 'no_show')
  FROM public.bookings b
  LEFT JOIN public.profiles p ON p.id = b.user_id
  WHERE b.class_id = _class_id
  ORDER BY b.status, b.seat_number NULLS LAST, b.created_at;
END;
$function$;
