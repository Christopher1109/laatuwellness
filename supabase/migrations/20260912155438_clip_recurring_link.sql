-- ============================================================================
-- Los planes recurrentes de Clip (Pagos Recurrentes) se pueden compartir
-- con MÁS DE UNA persona con el mismo link -- o sea, el staff solo tiene
-- que crear el link UNA VEZ por membresía (The OGs, Two a Day Your Way,
-- The Everyday) desde el dashboard de Clip, y la página web puede mandar
-- ahí directo a cualquier cliente que la seleccione. Ya no hace falta
-- generar nada por cliente.
-- ============================================================================

ALTER TABLE public.token_plans ADD COLUMN IF NOT EXISTS clip_recurring_link_url text;
