-- Founders Access se reabre a la venta hasta el domingo 8 de noviembre de 2026
-- (23:59, Monterrey), con el mismo límite de 25 lugares.
UPDATE public.token_plans
SET available_until = '2026-11-08 23:59:59 America/Monterrey'::timestamptz,
    terms = replace(terms, 'Promoción disponible hasta el 26 de octubre de 2026 (23:59, hora de Monterrey)', 'Promoción disponible hasta el 8 de noviembre de 2026 (23:59, hora de Monterrey)')
WHERE id = 'b4302499-2791-4d01-bde8-345ccfc0d59d';
