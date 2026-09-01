ALTER TABLE public.token_plans ADD COLUMN IF NOT EXISTS stripe_price_id text NOT NULL DEFAULT '';
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS external_ref text;
CREATE UNIQUE INDEX IF NOT EXISTS transactions_external_ref_key ON public.transactions(external_ref) WHERE external_ref IS NOT NULL;

UPDATE public.token_plans SET stripe_price_id = m.price_id FROM (VALUES
  ('Newcomer','newcomer_onetime'),
  ('Single','single_class_onetime'),
  ('3 Classes','three_classes_onetime'),
  ('5 Classes','five_classes_onetime'),
  ('10 Classes','ten_classes_onetime'),
  ('Choose Your Way','choose_your_way_monthly'),
  ('Double Up / Mix & Match','double_up_mix_match_monthly'),
  ('The OGs','the_ogs_monthly'),
  ('Two a Day Your Way','two_a_day_your_way_monthly'),
  ('The Everyday','the_everyday_monthly'),
  ('Align — Doris Fisio','align_doris_fisio_onetime'),
  ('Contrast','contrast_onetime')
) AS m(name, price_id)
WHERE public.token_plans.name = m.name;

CREATE OR REPLACE FUNCTION public.fulfill_plan_purchase(_user_id uuid, _plan_id uuid, _external_ref text, _payment_method text DEFAULT 'tarjeta')
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _p public.token_plans; _tx uuid;
BEGIN
  SELECT id INTO _tx FROM public.transactions WHERE external_ref = _external_ref;
  IF FOUND THEN RETURN _tx; END IF;

  SELECT * INTO _p FROM public.token_plans WHERE id = _plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PLAN_NOT_FOUND'; END IF;

  INSERT INTO public.transactions (user_id, plan_id, amount_cents, tokens, currency, payment_method, status, external_ref)
    VALUES (_user_id, _p.id, _p.price_cents, _p.tokens, _p.currency, coalesce(_payment_method,'tarjeta'), 'completed', _external_ref)
    RETURNING id INTO _tx;

  INSERT INTO public.token_ledger (user_id, delta, reason, transaction_id)
    VALUES (_user_id, _p.tokens, 'Pago en línea: ' || _p.name, _tx);

  RETURN _tx;
END; $$;

REVOKE ALL ON FUNCTION public.fulfill_plan_purchase(uuid, uuid, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_plan_purchase(uuid, uuid, text, text) TO service_role;