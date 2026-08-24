-- ============================================================================
-- FIX CRÍTICO: la tabla `bookings` nunca tuvo permiso de UPDATE para
-- `authenticated` (solo tenía SELECT), ni una política RLS que lo permitiera.
-- Los cambios directos de estatus/lugar del panel admin (asignar lugar,
-- cancelar, pasar de lista de espera, "sin espacio·devolver") fallaban
-- silenciosamente por permisos — no era un bug de la interfaz, era que la
-- base de datos rechazaba el UPDATE.
-- ============================================================================
GRANT UPDATE ON public.bookings TO authenticated;

CREATE POLICY "bookings_staff_admin_update" ON public.bookings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.is_staff(auth.uid()))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.is_staff(auth.uid()));
