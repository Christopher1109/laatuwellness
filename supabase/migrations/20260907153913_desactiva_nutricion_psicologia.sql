-- ============================================================================
-- Corrección de contenido pedida por Lorena (por ahora, mientras se define el
-- Health Coach): la página pública ya NO debe ofrecer Nutrición ni Psicología.
-- Se desactivan (no se borran) los módulos, sus horarios de consultorio
-- futuros y los tipos de clase asociados, para no perder historial.
--
-- Esto deja el sitio con exactamente los 5 pilares pedidos: Reformer, 4mat,
-- Align (DorisFisio), Fuel y Contrast.
-- ============================================================================

UPDATE public.site_modules
SET enabled = false
WHERE key IN ('nutricion', 'psicologia');

-- Quita las clases futuras sin reservas de esos dos consultorios para que no
-- sigan apareciendo en horarios/agenda.
DELETE FROM public.classes
WHERE module_key IN ('nutricion', 'psicologia')
  AND starts_at > now()
  AND id NOT IN (SELECT class_id FROM public.bookings);
