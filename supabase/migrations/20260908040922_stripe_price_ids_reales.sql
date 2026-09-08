-- ============================================================================
-- Reemplaza los placeholders de stripe_price_id por los Price IDs reales que
-- Lorena ya tenía creados en Stripe (confirmado con export de su Dashboard,
-- 2026-09-02). De paso confirma que Two a Day Your Way, The OGs y The
-- Everyday ya estaban en $8,500 / $7,500 / $7,000 en Stripe — coincide con
-- los precios que ya actualizamos en la base.
--
-- NOTA: 'Align — Doris Fisio' (el plan viejo, ya inactivo) es el que se
-- había quedado con el placeholder 'align_doris_fisio_onetime'. El precio
-- real de Stripe para ese monto ($850) en realidad corresponde al plan
-- activo actual 'DorisFisio — Upper o Lower', así que el price_id se mueve
-- ahí. 'DorisFisio — Full Body' ($1,200) se agregó por separado, creado en
-- Stripe el 7/sept/2026.
-- ============================================================================

UPDATE public.token_plans SET stripe_price_id = m.price_id FROM (VALUES
  ('newcomer_onetime', 'price_1UB4gdDPgAzvWuR2MoGGEZql'),
  ('single_class_onetime', 'price_1UB4gdDPgAzvWuR2U53WXHpj'),
  ('ten_classes_onetime', 'price_1UB4gcDPgAzvWuR27snjt5e4'),
  ('choose_your_way_monthly', 'price_1UB4gcDPgAzvWuR29AW9Wd3O'),
  ('three_classes_onetime', 'price_1UB4gbDPgAzvWuR2foyJis9S'),
  ('five_classes_onetime', 'price_1UB4gbDPgAzvWuR2J8JgZ2wi'),
  ('double_up_mix_match_monthly', 'price_1UB4gaDPgAzvWuR22g7nXLUy'),
  ('the_ogs_monthly', 'price_1UB4gaDPgAzvWuR2VeooCn7w'),
  ('two_a_day_your_way_monthly', 'price_1UB4gZDPgAzvWuR2XWXhQhPv'),
  ('the_everyday_monthly', 'price_1UB4gZDPgAzvWuR2n5YsFukM'),
  ('contrast_onetime', 'price_1UB4gYDPgAzvWuR2A8bzKrgf')
) AS m(placeholder, price_id)
WHERE public.token_plans.stripe_price_id = m.placeholder;

-- 'Align — Doris Fisio' (inactivo) se queda sin price_id: ya no se usa.
UPDATE public.token_plans SET stripe_price_id = ''
WHERE name = 'Align — Doris Fisio' AND stripe_price_id = 'align_doris_fisio_onetime';

-- El price_id real de $850 pasa al plan activo equivalente.
UPDATE public.token_plans SET stripe_price_id = 'price_1UB4gZDPgAzvWuR2uKHeV1ya'
WHERE name = 'DorisFisio — Upper o Lower';

-- DorisFisio — Full Body ($1,200): precio creado en Stripe el 7/sept/2026.
UPDATE public.token_plans SET stripe_price_id = 'price_1UDGOmDPgAzvWuR2Xp3Gletw'
WHERE name = 'DorisFisio — Full Body';
