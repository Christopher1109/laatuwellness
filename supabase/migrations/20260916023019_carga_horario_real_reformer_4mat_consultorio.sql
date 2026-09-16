-- ============================================================================
-- Carga el horario REAL que Lorena mandó (capturas del 15/sept/2026) como
-- plantilla semanal, borra las clases ficticias futuras de reformer/4mat
-- que no tengan reservaciones, regenera con el horario real, y oculta
-- Contrast (no se ofrece todavía).
--
-- NOTA para confirmar con Lorena:
--  - Reformer lunes 10am: la imagen tenía "?" -- queda sin coach asignado.
--  - Reformer jueves 6:15pm: la imagen tenía "MONTSE?" -- se asignó a
--    Montse, pero confirmar si es definitivo.
--  - 4mat lunes-viernes 7/8/9am: quedan como horas bloqueadas SIN coach
--    (pendiente, como se pidió) -- alguien tiene que asignarlas después
--    desde el panel de Programación de clases antes de que sean reales
--    para reservar en esos horarios.
-- ============================================================================

-- 1) Limpieza: borra clases futuras de reformer/4mat que aún no tengan
--    ninguna reservación (no se toca nada que ya esté reservado).
DELETE FROM public.classes
WHERE module_key IN ('reformer', '4mat')
  AND starts_at > now()
  AND id NOT IN (SELECT class_id FROM public.bookings);

-- 2) Oculta Contrast por ahora.
UPDATE public.site_modules SET enabled = false WHERE key = 'contraste';

-- 3) Plantilla de Reformer.
INSERT INTO public.schedule_templates (module_key, weekday, start_time, coach_id, is_rotation, room, capacity)
SELECT 'reformer', v.weekday, v.start_time,
  (SELECT id FROM public.staff_profiles WHERE email = v.coach_email),
  v.is_rotation, 'Reformer', 10
FROM (VALUES
  (0, '07:00'::time, 'moni@laatuwellness.com', false),
  (1, '07:00'::time, 'lore@laatuwellness.com', false),
  (2, '07:00'::time, 'jocelyn@laatuwellness.com', false),
  (3, '07:00'::time, 'moni@laatuwellness.com', false),
  (4, '07:00'::time, 'gloria@laatuwellness.com', false),
  (0, '08:00'::time, 'moni@laatuwellness.com', false),
  (1, '08:00'::time, 'lore@laatuwellness.com', false),
  (2, '08:00'::time, 'jocelyn@laatuwellness.com', false),
  (3, '08:00'::time, 'moni@laatuwellness.com', false),
  (4, '08:00'::time, 'gloria@laatuwellness.com', false),
  (0, '09:00'::time, 'moni@laatuwellness.com', false),
  (1, '09:00'::time, 'roberto@laatuwellness.com', false),
  (2, '09:00'::time, 'lore@laatuwellness.com', false),
  (3, '09:00'::time, 'moni@laatuwellness.com', false),
  (4, '09:00'::time, 'gloria@laatuwellness.com', false),
  (5, '09:00'::time, NULL, true),
  (6, '09:00'::time, NULL, true),
  (0, '10:00'::time, NULL, false),
  (1, '10:00'::time, 'roberto@laatuwellness.com', false),
  (2, '10:00'::time, 'jhoana@laatuwellness.com', false),
  (3, '10:00'::time, 'roberto@laatuwellness.com', false),
  (4, '10:00'::time, 'gloria@laatuwellness.com', false),
  (5, '10:00'::time, NULL, true),
  (6, '10:00'::time, NULL, true),
  (0, '11:00'::time, 'lore@laatuwellness.com', false),
  (1, '11:00'::time, 'roberto@laatuwellness.com', false),
  (2, '11:00'::time, 'jhoana@laatuwellness.com', false),
  (3, '11:00'::time, 'lore@laatuwellness.com', false),
  (4, '11:00'::time, 'lore@laatuwellness.com', false),
  (5, '11:00'::time, NULL, true),
  (6, '11:00'::time, NULL, true),
  (0, '17:00'::time, 'jhoana@laatuwellness.com', false),
  (1, '17:00'::time, 'betzy@laatuwellness.com', false),
  (2, '17:00'::time, 'nancy@laatuwellness.com', false),
  (3, '17:00'::time, 'roberto@laatuwellness.com', false),
  (4, '17:00'::time, 'jocelyn@laatuwellness.com', false),
  (0, '18:15'::time, 'jhoana@laatuwellness.com', false),
  (1, '18:15'::time, 'betzy@laatuwellness.com', false),
  (2, '18:15'::time, 'nancy@laatuwellness.com', false),
  (3, '18:15'::time, 'montse@laatuwellness.com', false),
  (4, '18:15'::time, 'jocelyn@laatuwellness.com', false),
  (0, '19:10'::time, 'jocelyn@laatuwellness.com', false),
  (1, '19:10'::time, 'montse@laatuwellness.com', false),
  (2, '19:10'::time, 'jocelyn@laatuwellness.com', false),
  (3, '19:10'::time, 'montse@laatuwellness.com', false)
) AS v(weekday, start_time, coach_email, is_rotation)
ON CONFLICT (module_key, weekday, start_time) DO UPDATE
  SET coach_id = EXCLUDED.coach_id, is_rotation = EXCLUDED.is_rotation;

-- 4) Plantilla de 4mat: horas bloqueadas, coach pendiente donde no se
--    especificó (7/8/9am lunes-viernes), Lore y Mafe donde sí.
INSERT INTO public.schedule_templates (module_key, weekday, start_time, coach_id, is_rotation, room, capacity)
SELECT '4mat', v.weekday, v.start_time,
  (SELECT id FROM public.staff_profiles WHERE email = v.coach_email),
  false, '4mat', 10
FROM (VALUES
  (0, '07:00'::time, NULL::text), (0, '08:00'::time, NULL), (0, '09:00'::time, NULL),
  (1, '07:00'::time, NULL), (1, '08:00'::time, NULL), (1, '09:00'::time, NULL),
  (2, '07:00'::time, NULL), (2, '08:00'::time, NULL), (2, '09:00'::time, NULL),
  (3, '07:00'::time, NULL), (3, '08:00'::time, NULL), (3, '09:00'::time, NULL),
  (4, '07:00'::time, NULL), (4, '08:00'::time, NULL), (4, '09:00'::time, NULL),
  (5, '09:00'::time, 'mafe@laatuwellness.com'),
  (0, '10:00'::time, 'lore@laatuwellness.com'),
  (1, '10:00'::time, 'lore@laatuwellness.com'),
  (2, '10:00'::time, 'lore@laatuwellness.com'),
  (3, '10:00'::time, 'lore@laatuwellness.com'),
  (4, '10:00'::time, 'lore@laatuwellness.com'),
  (5, '10:00'::time, 'lore@laatuwellness.com'),
  (6, '10:00'::time, 'mafe@laatuwellness.com'),
  (2, '18:00'::time, 'mafe@laatuwellness.com')
) AS v(weekday, start_time, coach_email)
ON CONFLICT (module_key, weekday, start_time) DO UPDATE
  SET coach_id = EXCLUDED.coach_id;

-- 5) Plantilla de Consultorio (DorisFisio): martes y jueves 9-12, sábado 10-12.
INSERT INTO public.schedule_templates (module_key, weekday, start_time, coach_id, is_rotation, room, capacity, duration_min)
SELECT 'rehabilitacion', v.weekday, v.start_time, NULL, false, 'Consultorio', 1, 40
FROM (VALUES
  (1, '09:00'::time), (1, '10:00'::time), (1, '11:00'::time), (1, '12:00'::time),
  (3, '09:00'::time), (3, '10:00'::time), (3, '11:00'::time), (3, '12:00'::time),
  (5, '10:00'::time), (5, '11:00'::time), (5, '12:00'::time)
) AS v(weekday, start_time)
ON CONFLICT (module_key, weekday, start_time) DO NOTHING;

-- 6) Genera las clases reales de las próximas 4 semanas para los 3 módulos.
-- publish_schedule_template exige rol admin vía auth.uid() -- como esta
-- migración corre con permisos de servicio, se evita esa validación
-- llamando a la lógica directamente aquí en vez de vía RPC pública.
DO $$
DECLARE
  _tpl record;
  _week int;
  _target_date date;
  _monday date := date_trunc('week', current_date)::date;
  _starts_at timestamptz;
  _resolved_coach uuid;
  _rotation_count int;
  _rotation_pos int;
  _iso_week int;
BEGIN
  FOR _tpl IN SELECT * FROM public.schedule_templates WHERE active = true LOOP
    FOR _week IN 0..3 LOOP
      _target_date := _monday + (_week * 7) + _tpl.weekday;
      IF _target_date < current_date THEN CONTINUE; END IF;
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

      IF NOT EXISTS (
        SELECT 1 FROM public.classes WHERE module_key = _tpl.module_key AND starts_at = _starts_at
      ) THEN
        INSERT INTO public.classes
          (module_key, room, instructor, coach_id, starts_at, capacity, duration_min, active)
        VALUES (
          _tpl.module_key, _tpl.room,
          COALESCE((SELECT full_name FROM public.staff_profiles WHERE id = _resolved_coach), ''),
          _resolved_coach, _starts_at, _tpl.capacity, _tpl.duration_min, true
        );
      END IF;
    END LOOP;
  END LOOP;
END $$;
