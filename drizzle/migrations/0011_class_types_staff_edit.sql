-- Recepción (staff) y administración pueden corregir nombres, cupos y
-- visibilidad de los tipos de clase; también ven los tipos ocultos.
DROP POLICY IF EXISTS class_types_public_read ON public.class_types;
CREATE POLICY class_types_public_read ON public.class_types FOR SELECT TO anon, authenticated
  USING (active OR public.has_role(auth.uid(), 'admin'::app_role) OR public.is_staff(auth.uid()));

DROP POLICY IF EXISTS class_types_staff_write ON public.class_types;
CREATE POLICY class_types_staff_write ON public.class_types FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'staff'::app_role) AND public.is_staff(auth.uid()))
  WITH CHECK (public.has_role(auth.uid(), 'staff'::app_role) AND public.is_staff(auth.uid()));
