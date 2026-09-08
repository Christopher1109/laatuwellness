-- ============================================================================
-- Actualiza precios de membresías (cambiaron desde que se cargó el catálogo
-- el 23 de agosto). Confirmado por Lorena:
--   The OGs:            $9,500 -> $7,500
--   The Everyday:        $9,000 -> $7,000
--   Two a Day Your Way: $11,000 -> $8,500  <- ASUMIDO, ver nota abajo
--
-- NOTA sobre Two a Day Your Way: Lorena dijo "ocho quinientos" por voz, lo
-- interpreté como $8,500 (patrón consistente con los otros dos montos, que
-- también rondan los $7,000-8,500). Si el precio real es otro (por ejemplo
-- $800 o $8,050), avisa y se corrige con un solo UPDATE.
-- ============================================================================

UPDATE public.token_plans SET price_cents = 750000 WHERE name = 'The OGs';
UPDATE public.token_plans SET price_cents = 850000 WHERE name = 'Two a Day Your Way';
UPDATE public.token_plans SET price_cents = 700000 WHERE name = 'The Everyday';
