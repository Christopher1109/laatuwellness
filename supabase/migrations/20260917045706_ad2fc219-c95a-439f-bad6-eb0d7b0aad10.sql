CREATE OR REPLACE FUNCTION public.publish_schedule_range(_module_key text, _from date, _to date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_month date := date_trunc('month', _from)::date;
  v_day date;
  v_t record;
  v_touched integer := 0;
  v_class_id uuid;
  v_booked integer;
  v_coach_name text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Solo administración puede actualizar la programación';
  END IF;

  FOR v_day IN SELECT generate_series(_from, _to, interval '1 day')::date LOOP
    FOR v_t IN
      SELECT * FROM public.schedule_templates
      WHERE module_key = _module_key
        AND month = v_month
        AND active = true
        AND weekday = EXTRACT(ISODOW FROM v_day)::int - 1
    LOOP
      SELECT id INTO v_class_id
      FROM public.classes
      WHERE module_key = _module_key
        AND (starts_at AT TIME ZONE 'America/Monterrey')::date = v_day
        AND to_char(starts_at AT TIME ZONE 'America/Monterrey', 'HH24:MI') = to_char(v_t.start_time, 'HH24:MI')
      LIMIT 1;

      SELECT full_name INTO v_coach_name FROM public.staff_profiles WHERE id = v_t.coach_id;

      IF v_class_id IS NULL THEN
        INSERT INTO public.classes (module_key, class_type_id, room, instructor, starts_at, duration_min, capacity, tokens_cost, active, coach_id)
        VALUES (
          _module_key,
          NULL,
          v_t.room,
          COALESCE(v_coach_name, 'Por asignar'),
          (v_day::text || ' ' || to_char(v_t.start_time, 'HH24:MI') || ':00')::timestamp AT TIME ZONE 'America/Monterrey',
          v_t.duration_min,
          v_t.capacity,
          1,
          true,
          v_t.coach_id
        );
        v_touched := v_touched + 1;
      ELSE
        SELECT count(*) INTO v_booked FROM public.bookings WHERE class_id = v_class_id AND status = 'reservada';
        UPDATE public.classes
        SET coach_id = v_t.coach_id,
            instructor = COALESCE(v_coach_name, instructor),
            room = v_t.room,
            duration_min = v_t.duration_min,
            capacity = GREATEST(v_t.capacity, v_booked),
            active = true
        WHERE id = v_class_id;
        v_touched := v_touched + 1;
      END IF;
    END LOOP;
  END LOOP;

  UPDATE public.classes c
  SET active = false
  WHERE c.module_key = _module_key
    AND (c.starts_at AT TIME ZONE 'America/Monterrey')::date BETWEEN _from AND _to
    AND NOT EXISTS (
      SELECT 1 FROM public.schedule_templates t
      WHERE t.module_key = _module_key
        AND t.month = v_month
        AND t.active = true
        AND t.weekday = EXTRACT(ISODOW FROM (c.starts_at AT TIME ZONE 'America/Monterrey')::date)::int - 1
        AND to_char(t.start_time, 'HH24:MI') = to_char(c.starts_at AT TIME ZONE 'America/Monterrey', 'HH24:MI')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.bookings b WHERE b.class_id = c.id AND b.status = 'reservada'
    );

  RETURN v_touched;
END;
$function$;

-- Republicar lo que resta del mes con la lógica corregida
DO $$
DECLARE
  v_mod text;
  v_day date;
  v_t record;
  v_class_id uuid;
  v_coach_name text;
  v_from date := current_date;
  v_to date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
  v_month date := date_trunc('month', current_date)::date;
BEGIN
  FOR v_mod IN SELECT DISTINCT module_key FROM public.schedule_templates WHERE month = v_month AND active LOOP
    FOR v_day IN SELECT generate_series(v_from, v_to, interval '1 day')::date LOOP
      FOR v_t IN
        SELECT * FROM public.schedule_templates
        WHERE module_key = v_mod AND month = v_month AND active = true
          AND weekday = EXTRACT(ISODOW FROM v_day)::int - 1
      LOOP
        SELECT id INTO v_class_id FROM public.classes
        WHERE module_key = v_mod
          AND (starts_at AT TIME ZONE 'America/Monterrey')::date = v_day
          AND to_char(starts_at AT TIME ZONE 'America/Monterrey', 'HH24:MI') = to_char(v_t.start_time, 'HH24:MI')
        LIMIT 1;

        SELECT full_name INTO v_coach_name FROM public.staff_profiles WHERE id = v_t.coach_id;

        IF v_class_id IS NULL THEN
          INSERT INTO public.classes (module_key, class_type_id, room, instructor, starts_at, duration_min, capacity, tokens_cost, active, coach_id)
          VALUES (v_mod, NULL, v_t.room, COALESCE(v_coach_name, 'Por asignar'),
            (v_day::text || ' ' || to_char(v_t.start_time, 'HH24:MI') || ':00')::timestamp AT TIME ZONE 'America/Monterrey',
            v_t.duration_min, v_t.capacity, 1, true, v_t.coach_id);
        ELSE
          UPDATE public.classes SET active = true, coach_id = v_t.coach_id,
            instructor = COALESCE(v_coach_name, instructor)
          WHERE id = v_class_id;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;