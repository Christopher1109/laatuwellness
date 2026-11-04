-- Nómina estimada de una coach para su perfil (y para administración).
-- Las coaches no usan el checador, así que lo que lleva del periodo se calcula
-- con las clases que ya impartió:
-- * Si tiene rangos por asistencia (coach_rate_tiers), cada clase paga la
--   tarifa del rango según sus reservaciones, igual que en Nómina.
-- * Si no, cada clase impartida cuenta como una hora de su tarifa.
-- Suma los ajustes de nómina (bonos o descuentos) capturados en el periodo y
-- proyecta lo que falta con las clases ya programadas. Solo lo ve
-- administración o la propia coach.

CREATE OR REPLACE FUNCTION public.coach_pay_summary(_coach_id uuid, _from timestamptz, _to timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _s public.staff_profiles; _has_tiers boolean; _r jsonb;
BEGIN
  SELECT * INTO _s FROM public.staff_profiles WHERE id = _coach_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(), 'admin') OR _s.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  _has_tiers := EXISTS (SELECT 1 FROM public.coach_rate_tiers WHERE coach_id = _coach_id);

  WITH cls AS (
    SELECT c.id, c.starts_at, c.duration_min, c.module_key, ct.name AS class_name,
           (SELECT count(*) FROM public.bookings b WHERE b.class_id = c.id AND b.status = 'reservada')::int AS attendance,
           (c.starts_at + make_interval(mins => c.duration_min)) <= now() AS given
      FROM public.classes c
      LEFT JOIN public.class_types ct ON ct.id = c.class_type_id
     WHERE c.coach_id = _coach_id AND c.active AND NOT coalesce(c.is_tbd, false)
       AND c.starts_at >= _from AND c.starts_at < _to
  ), priced AS (
    SELECT cls.*,
           CASE WHEN _has_tiers THEN coalesce((
                  SELECT t.rate_cents FROM public.coach_rate_tiers t
                   WHERE t.coach_id = _coach_id AND t.min_attendance <= cls.attendance
                   ORDER BY t.min_attendance DESC LIMIT 1), 0)
                ELSE coalesce(_s.hourly_rate_cents, 0) END AS pay_cents
      FROM cls
  )
  SELECT jsonb_build_object(
    'rate_cents', coalesce(_s.hourly_rate_cents, 0),
    'by_tiers', _has_tiers,
    'classes_given', (SELECT count(*) FROM priced WHERE given),
    'minutes_given', coalesce((SELECT sum(duration_min) FROM priced WHERE given), 0),
    'earned_cents', coalesce((SELECT sum(pay_cents) FROM priced WHERE given), 0),
    'classes_scheduled', (SELECT count(*) FROM priced WHERE NOT given),
    'projected_cents', coalesce((SELECT sum(pay_cents) FROM priced WHERE NOT given), 0),
    'adjustments_cents', coalesce((
      SELECT sum(a.amount_cents) FROM public.payroll_adjustments a
       WHERE a.staff_id = _coach_id AND a.created_at >= _from AND a.created_at < _to), 0),
    'classes', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'class_id', id, 'starts_at', starts_at, 'class_name', class_name,
               'module_key', module_key, 'attendance', attendance, 'given', given,
               'pay_cents', pay_cents) ORDER BY starts_at)
        FROM priced), '[]'::jsonb)
  ) INTO _r;
  RETURN _r;
END;
$function$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.coach_pay_summary(uuid, timestamptz, timestamptz) FROM public, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.coach_pay_summary(uuid, timestamptz, timestamptz) TO authenticated;
