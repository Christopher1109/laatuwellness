-- ============================================================================
-- Plantilla semanal de horarios: en vez de agregar clase por clase, se
-- arma UNA vez el patrón de la semana (qué hora, qué día, qué coach), y un
-- botón genera las clases reales de las próximas semanas a partir de eso.
--
-- weekday: 0=lunes ... 6=domingo (para que coincida con como lo escribió
-- Lorena: LUNES...DOMINGO de izquierda a derecha).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.schedule_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_key text NOT NULL,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time time NOT NULL,
  duration_min int NOT NULL DEFAULT 50,
  room text NOT NULL DEFAULT '',
  capacity int NOT NULL DEFAULT 10,
  coach_id uuid REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
  is_rotation boolean NOT NULL DEFAULT false, -- true = "ROTACION": el coach se
    -- resuelve contra weekend_coach_rotation al momento de generar, no es fijo
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (module_key, weekday, start_time)
);
GRANT SELECT ON public.schedule_templates TO authenticated;
GRANT ALL ON public.schedule_templates TO service_role;
ALTER TABLE public.schedule_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "schedule_templates_staff_select" ON public.schedule_templates;
CREATE POLICY "schedule_templates_staff_select" ON public.schedule_templates FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "schedule_templates_admin_write" ON public.schedule_templates;
CREATE POLICY "schedule_templates_admin_write" ON public.schedule_templates FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Genera las clases reales para las proximas _weeks semanas a partir de la
-- plantilla de un modulo. Es seguro correrlo varias veces: no duplica
-- clases que ya existan para esa fecha/hora/modulo.
CREATE OR REPLACE FUNCTION public.publish_schedule_template(
  _module_key text,
  _weeks int DEFAULT 4
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tpl record;
  _week int;
  _target_date date;
  _monday date := date_trunc('week', current_date)::date; -- lunes de esta semana
  _starts_at timestamptz;
  _resolved_coach uuid;
  _rotation_count int;
  _rotation_pos int;
  _iso_week int;
  _created int := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  FOR _tpl IN
    SELECT * FROM public.schedule_templates
    WHERE module_key = _module_key AND active = true
  LOOP
    FOR _week IN 0.._weeks - 1 LOOP
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
        SELECT 1 FROM public.classes
        WHERE module_key = _tpl.module_key AND starts_at = _starts_at
      ) THEN
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
        _created := _created + 1;
      END IF;
    END LOOP;
  END LOOP;

  RETURN _created;
END;
$$;
GRANT EXECUTE ON FUNCTION public.publish_schedule_template(text, int) TO authenticated;
