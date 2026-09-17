CREATE TABLE IF NOT EXISTS public.schedule_blackouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_key text NOT NULL,
  day date NOT NULL,
  note text NOT NULL DEFAULT '',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (module_key, day)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedule_blackouts TO authenticated;
GRANT ALL ON public.schedule_blackouts TO service_role;

ALTER TABLE public.schedule_blackouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff puede ver dias cerrados"
ON public.schedule_blackouts FOR SELECT TO authenticated
USING (public.is_staff(auth.uid()));

CREATE POLICY "Admin gestiona dias cerrados"
ON public.schedule_blackouts FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.publish_schedule_range(_module_key text, _from date, _to date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.schedule_blackouts b
      WHERE b.module_key = _module_key AND b.day = v_day
    );

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
        AND starts_at::date = v_day
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
    AND c.starts_at::date BETWEEN _from AND _to
    AND (
      EXISTS (
        SELECT 1 FROM public.schedule_blackouts b
        WHERE b.module_key = _module_key AND b.day = c.starts_at::date
      )
      OR NOT EXISTS (
        SELECT 1 FROM public.schedule_templates t
        WHERE t.module_key = _module_key
          AND t.month = v_month
          AND t.active = true
          AND t.weekday = EXTRACT(ISODOW FROM c.starts_at::date)::int - 1
          AND to_char(t.start_time, 'HH24:MI') = to_char(c.starts_at AT TIME ZONE 'America/Monterrey', 'HH24:MI')
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.bookings b WHERE b.class_id = c.id AND b.status = 'reservada'
    );

  RETURN v_touched;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.publish_schedule_range(text, date, date) FROM anon;

-- Contrast Therapy no se ofrece por ahora
UPDATE public.site_modules SET enabled = false WHERE key = 'contraste';

UPDATE public.classes c
SET active = false
WHERE c.module_key = 'contraste'
  AND c.starts_at >= now()
  AND NOT EXISTS (
    SELECT 1 FROM public.bookings b WHERE b.class_id = c.id AND b.status = 'reservada'
  );