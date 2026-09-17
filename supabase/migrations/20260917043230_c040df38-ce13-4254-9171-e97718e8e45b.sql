CREATE OR REPLACE FUNCTION public.publish_schedule_range(_module_key text, _from date, _to date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _tpl record;
  _cls record;
  _target_date date;
  _starts_at timestamptz;
  _resolved_coach uuid;
  _rotation_count int;
  _rotation_pos int;
  _iso_week int;
  _touched int := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  IF _to < _from THEN
    RAISE EXCEPTION 'INVALID_RANGE';
  END IF;

  FOR _tpl IN
    SELECT * FROM public.schedule_templates
    WHERE module_key = _module_key AND active = true
  LOOP
    _target_date := _from;
    WHILE _target_date <= _to LOOP
      IF ((extract(isodow FROM _target_date)::int) - 1) = _tpl.weekday THEN
        _starts_at := _target_date + _tpl.start_time;

        _resolved_coach := _tpl.coach_id;
        IF _tpl.is_rotation THEN
          SELECT count(*) INTO _rotation_count FROM public.weekend_coach_rotation
            WHERE day_of_week = extract(dow FROM _target_date)::int;
          IF _rotation_count > 0 THEN
            _iso_week := extract(week FROM _target_date)::int;
            _rotation_pos := (_iso_week % _rotation_count) + 1;
            SELECT coach_id INTO _resolved_coach FROM public.weekend_coach_rotation
              WHERE day_of_week = extract(dow FROM _target_date)::int AND position = _rotation_pos;
          END IF;
        END IF;

        IF EXISTS (
          SELECT 1 FROM public.classes
          WHERE module_key = _tpl.module_key AND starts_at = _starts_at
        ) THEN
          UPDATE public.classes SET
            room = _tpl.room,
            coach_id = _resolved_coach,
            instructor = COALESCE((SELECT full_name FROM public.staff_profiles WHERE id = _resolved_coach), ''),
            capacity = GREATEST(_tpl.capacity, (SELECT count(*)::int FROM public.bookings b WHERE b.class_id = classes.id AND b.status = 'booked')),
            duration_min = _tpl.duration_min,
            active = true
          WHERE module_key = _tpl.module_key AND starts_at = _starts_at;
          _touched := _touched + 1;
        ELSE
          INSERT INTO public.classes
            (module_key, room, instructor, coach_id, starts_at, capacity, duration_min, active)
          VALUES (
            _tpl.module_key,
            _tpl.room,
            COALESCE((SELECT full_name FROM public.staff_profiles WHERE id = _resolved_coach), ''),
            _resolved_coach,
            _starts_at,
            _tpl.capacity,
            _tpl.duration_min,
            true
          );
          _touched := _touched + 1;
        END IF;
      END IF;
      _target_date := _target_date + 1;
    END LOOP;
  END LOOP;

  -- Clases del periodo que ya no existen en la plantilla y no tienen reservas: se ocultan
  FOR _cls IN
    SELECT c.id, c.starts_at FROM public.classes c
    WHERE c.module_key = _module_key
      AND c.starts_at >= _from::timestamptz
      AND c.starts_at < (_to + 1)::timestamptz
      AND c.active = true
      AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.class_id = c.id AND b.status IN ('booked','waitlisted'))
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.schedule_templates t
      WHERE t.module_key = _module_key AND t.active = true
        AND ((extract(isodow FROM _cls.starts_at)::int) - 1) = t.weekday
        AND t.start_time = (_cls.starts_at AT TIME ZONE current_setting('TimeZone'))::time
    ) THEN
      UPDATE public.classes SET active = false WHERE id = _cls.id;
      _touched := _touched + 1;
    END IF;
  END LOOP;

  RETURN _touched;
END;
$function$;