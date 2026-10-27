-- Corrige la lectura pública de horarios y tipos de clase: los visitantes sin
-- sesión (anon) no pueden ejecutar is_staff/has_role, así que tienen su propia
-- regla que no los llama.

DROP POLICY IF EXISTS classes_public_read ON public.classes;
DROP POLICY IF EXISTS classes_anon_read ON public.classes;
DROP POLICY IF EXISTS classes_auth_read ON public.classes;
CREATE POLICY classes_anon_read ON public.classes FOR SELECT TO anon
  USING (active AND starts_at < public.booking_window_end());
CREATE POLICY classes_auth_read ON public.classes FOR SELECT TO authenticated
  USING (
    (active AND (starts_at < public.booking_window_end() OR public.is_staff(auth.uid())))
    OR public.has_role(auth.uid(), 'admin'::app_role)
  );

DROP POLICY IF EXISTS class_types_public_read ON public.class_types;
DROP POLICY IF EXISTS class_types_anon_read ON public.class_types;
DROP POLICY IF EXISTS class_types_auth_read ON public.class_types;
CREATE POLICY class_types_anon_read ON public.class_types FOR SELECT TO anon
  USING (active);
CREATE POLICY class_types_auth_read ON public.class_types FOR SELECT TO authenticated
  USING (active OR public.has_role(auth.uid(), 'admin'::app_role) OR public.is_staff(auth.uid()));

GRANT EXECUTE ON FUNCTION public.booking_window_end() TO anon, authenticated;
