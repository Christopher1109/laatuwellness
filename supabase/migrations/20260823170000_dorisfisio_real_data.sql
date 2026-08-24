-- ============================================================================
-- DorisFisio — datos reales confirmados por WhatsApp (23 ago 2026):
--   1) Política de cancelación de 12 horas también aplica aquí.
--   2) Se paga la sesión completa en línea; si cancela después de las 12
--      horas, se retiene $400 de lo pagado.
--   3) Precios: Upper o Lower $850, Full Body $1200.
--   4) Por permisos sanitarios y de espacio, la página pública NO puede
--      mencionar "fisioterapia" ni "rehabilitación" — solo "DorisFisio" y
--      los servicios descritos como "recovery".
--   5) Horario real: martes y jueves 9, 10, 11 y 12 del día; sábado 10, 11
--      y 12 del día (antes estaba mal: lunes/miércoles/viernes 13:00).
-- ============================================================================

-- 1) Contenido público del módulo — sin la palabra "fisioterapia".
UPDATE public.site_modules SET
  name = 'DorisFisio',
  description = 'Recovery uno a uno para volver al movimiento sin dolor.',
  long_description = 'Sesiones individuales de recovery con Doris. Valoración '
    || 'funcional y trabajo manual enfocado en movilidad y bienestar del '
    || 'cuerpo. Upper/Lower o Full Body, según lo que necesites ese día.'
WHERE key = 'rehabilitacion';

-- 2) Reemplaza las clases futuras auto-generadas con el horario incorrecto
-- (lunes/miércoles/viernes 13:00) por el horario real, siempre que no
-- tengan reservaciones (para no romper reservas ya hechas).
DELETE FROM public.classes
WHERE module_key = 'rehabilitacion'
  AND starts_at > now()
  AND id NOT IN (SELECT class_id FROM public.bookings);

INSERT INTO public.classes (module_key, room, instructor, starts_at, capacity, duration_min, tokens_cost, active)
SELECT 'rehabilitacion', 'Consultorio', 'DorisFisio',
       (date_trunc('day', now() at time zone 'America/Monterrey') + (d || ' days')::interval + x.hour)
         at time zone 'America/Monterrey',
       1, 40, 1, true
FROM generate_series(0, 21) AS d
CROSS JOIN (VALUES
  (interval '9 hours'), (interval '10 hours'), (interval '11 hours'), (interval '12 hours')
) AS x(hour)
WHERE extract(dow FROM (now() at time zone 'America/Monterrey')::date + d) IN (2, 4) -- martes, jueves
UNION ALL
SELECT 'rehabilitacion', 'Consultorio', 'DorisFisio',
       (date_trunc('day', now() at time zone 'America/Monterrey') + (d || ' days')::interval + x.hour)
         at time zone 'America/Monterrey',
       1, 40, 1, true
FROM generate_series(0, 21) AS d
CROSS JOIN (VALUES
  (interval '10 hours'), (interval '11 hours'), (interval '12 hours')
) AS x(hour)
WHERE extract(dow FROM (now() at time zone 'America/Monterrey')::date + d) = 6; -- sábado

-- 3) Precios reales de sesión — se reemplaza el paquete genérico "Align —
-- Doris Fisio" ($850 fijo) por dos paquetes que reflejan el precio real de
-- cada tipo de sesión.
UPDATE public.token_plans SET active = false WHERE name = 'Align — Doris Fisio';

INSERT INTO public.token_plans (name, description, subtitle, category, tokens, price_cents, recurring, validity_days, active, sort_order, terms)
VALUES
  ('DorisFisio — Upper o Lower', 'Sesión de recovery de tren superior o inferior.', '40 min',
   'consulta', 1, 85000, false, 30, true, 11,
   'Sujeto a disponibilidad y reservas en calendario. Cancelaciones con menos '
   || 'de 12 horas de anticipación retienen $400 de lo pagado.'),
  ('DorisFisio — Full Body', 'Sesión de recovery de cuerpo completo.', '40 min',
   'consulta', 1, 120000, false, 30, true, 12,
   'Sujeto a disponibilidad y reservas en calendario. Cancelaciones con menos '
   || 'de 12 horas de anticipación retienen $400 de lo pagado.')
ON CONFLICT DO NOTHING;
