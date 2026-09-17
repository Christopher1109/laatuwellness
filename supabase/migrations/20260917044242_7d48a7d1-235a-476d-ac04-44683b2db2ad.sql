-- 1) Cada renglón del patrón de horarios pertenece a un mes específico
ALTER TABLE public.schedule_templates
  ADD COLUMN IF NOT EXISTS month date NOT NULL DEFAULT date_trunc('month', current_date)::date;

-- Lo ya existente queda como el patrón del mes en curso (septiembre 2026)
UPDATE public.schedule_templates
SET month = date_trunc('month', current_date)::date
WHERE month IS NULL;

-- La unicidad ahora incluye el mes: mismo módulo/día/hora puede existir en meses distintos
ALTER TABLE public.schedule_templates
  DROP CONSTRAINT schedule_templates_module_key_weekday_start_time_key;
ALTER TABLE public.schedule_templates
  ADD CONSTRAINT schedule_templates_module_key_weekday_start_time_month_key
  UNIQUE (module_key, weekday, start_time, month);

-- 2) Publicar/actualizar solo con la plantilla del mes correspondiente
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

  -- Recorrer día a día el periodo solicitado
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

  -- Ocultar clases del periodo que ya no tienen plantilla activa y no tienen reservas
  UPDATE public.classes c
  SET active = false
  WHERE c.module_key = _module_key
    AND c.starts_at::date BETWEEN _from AND _to
    AND NOT EXISTS (
      SELECT 1 FROM public.schedule_templates t
      WHERE t.module_key = _module_key
        AND t.month = v_month
        AND t.active = true
        AND t.weekday = EXTRACT(ISODOW FROM c.starts_at::date)::int - 1
        AND to_char(t.start_time, 'HH24:MI') = to_char(c.starts_at AT TIME ZONE 'America/Monterrey', 'HH24:MI')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.bookings b WHERE b.class_id = c.id AND b.status = 'reservada'
    );

  RETURN v_touched;
END;
$$;

-- 3) Copiar el patrón de un mes a otro (para no empezar de cero si no quieren)
CREATE OR REPLACE FUNCTION public.copy_schedule_month(_module_key text, _from_month date, _to_month date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Solo administración puede copiar la programación';
  END IF;

  INSERT INTO public.schedule_templates (module_key, weekday, start_time, duration_min, room, capacity, coach_id, is_rotation, active, month)
  SELECT module_key, weekday, start_time, duration_min, room, capacity, coach_id, is_rotation, active,
         date_trunc('month', _to_month)::date
  FROM public.schedule_templates
  WHERE module_key = _module_key
    AND month = date_trunc('month', _from_month)::date
  ON CONFLICT (module_key, weekday, start_time, month) DO UPDATE
  SET coach_id = EXCLUDED.coach_id,
      is_rotation = EXCLUDED.is_rotation,
      active = EXCLUDED.active,
      duration_min = EXCLUDED.duration_min,
      room = EXCLUDED.room,
      capacity = EXCLUDED.capacity;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;