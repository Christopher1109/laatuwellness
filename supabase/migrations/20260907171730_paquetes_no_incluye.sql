-- ============================================================================
-- Agrega "No incluye" a cada paquete/membresía, para que en /paquetes se
-- pueda mostrar junto a "Incluye" y "Restricciones" (Lorena pidió que se
-- vea claro qué SÍ y qué NO trae cada uno).
--
-- Los valores que se llenan aquí son inferencias directas de lo que ya dice
-- la columna `includes` de cada plan (p.ej. si incluye "1 Align", entonces
-- una segunda sesión de Align NO está incluida) — no son datos nuevos
-- inventados. Cualquier ajuste real lo puede hacer Lorena desde el panel
-- admin o pidiéndomelo.
-- ============================================================================

ALTER TABLE public.token_plans ADD COLUMN IF NOT EXISTS excludes text NOT NULL DEFAULT '';

UPDATE public.token_plans SET excludes =
  'No incluye Align, Contrast ni Fuel — se compran por separado.'
WHERE category = 'clases_pilates';

UPDATE public.token_plans SET excludes =
  'No incluye sesiones adicionales de Align o Contrast fuera de las que trae el plan; extras se cobran aparte.'
WHERE name IN ('The OGs', 'Two a Day Your Way');

UPDATE public.token_plans SET excludes =
  'El Align no es gratis (solo 50% de descuento). No incluye sesiones adicionales de Contrast o Fuel fuera de las que trae el plan.'
WHERE name = 'The Everyday';
