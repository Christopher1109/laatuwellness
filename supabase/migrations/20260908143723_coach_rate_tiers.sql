-- ============================================================================
-- Pago escalonado de coaches por ocupación del salón: precio FIJO por clase
-- según cuántos alumnos asistieron (no por persona). Se define por rangos:
-- "desde X asistentes, la clase vale $Y" — se aplica el rango más alto que
-- sea <= la asistencia real de esa clase.
--
-- Ej: tiers (1, $200), (3, $250), (5, $300), (8, $350), (10, $400 "full
-- house") -> una clase con 6 asistentes paga $300 (el tier de "5" es el
-- más alto que no se pasa de 6).
--
-- Si un coach no tiene tiers configurados, nómina sigue usando su tarifa
-- por hora de siempre (comportamiento actual, sin cambios).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.coach_rate_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  min_attendance int NOT NULL CHECK (min_attendance >= 0),
  rate_cents int NOT NULL CHECK (rate_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (coach_id, min_attendance)
);
GRANT SELECT ON public.coach_rate_tiers TO authenticated;
GRANT ALL ON public.coach_rate_tiers TO service_role;
ALTER TABLE public.coach_rate_tiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "coach_rate_tiers_admin_write" ON public.coach_rate_tiers;
CREATE POLICY "coach_rate_tiers_admin_write" ON public.coach_rate_tiers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Un coach puede ver sus propios tiers (para entender cómo se le paga).
DROP POLICY IF EXISTS "coach_rate_tiers_self_select" ON public.coach_rate_tiers;
CREATE POLICY "coach_rate_tiers_self_select" ON public.coach_rate_tiers FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.staff_profiles sp
      WHERE sp.id = coach_id AND sp.user_id = auth.uid()
    )
  );
