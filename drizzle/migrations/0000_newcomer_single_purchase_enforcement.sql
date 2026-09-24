ALTER TABLE public.token_plans
  ADD COLUMN IF NOT EXISTS purchasable_once boolean NOT NULL DEFAULT false;

UPDATE public.token_plans
SET purchasable_once = true
WHERE name = 'Newcomer';

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

  PERFORM pg_advisory_xact_lock(hashtextextended(_user_id::text || ':' || _plan_id::text, 0));

  IF _p.purchasable_once AND EXISTS (
    SELECT 1 FROM public.transactions
    WHERE user_id = _user_id AND plan_id = _plan_id AND status = 'completed'
  ) THEN
    RAISE EXCEPTION 'PLAN_ALREADY_PURCHASED';
  END IF;

  INSERT INTO public.transactions (user_id, plan_id, amount_cents, tokens, currency, payment_method, status, external_ref)
    VALUES (_user_id, _p.id, _p.price_cents, _p.tokens, _p.currency, coalesce(_payment_method,'tarjeta'), 'completed', _external_ref)
    RETURNING id INTO _tx;

  INSERT INTO public.token_ledger (user_id, delta, reason, transaction_id)
    VALUES (_user_id, _p.tokens, 'Pago en línea: ' || _p.name, _tx);

  RETURN _tx;
END; $$;

REVOKE ALL ON FUNCTION public.fulfill_plan_purchase(uuid, uuid, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_plan_purchase(uuid, uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_purchase_plan(_user_id uuid, _plan_id uuid, _payment_method text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _p public.token_plans; _tx uuid;
BEGIN
  IF NOT (public.is_staff(auth.uid()) OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT * INTO _p FROM public.token_plans WHERE id = _plan_id AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'PLAN_NOT_FOUND'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(_user_id::text || ':' || _plan_id::text, 0));

  IF _p.purchasable_once AND EXISTS (
    SELECT 1 FROM public.transactions
    WHERE user_id = _user_id AND plan_id = _plan_id AND status = 'completed'
  ) THEN
    RAISE EXCEPTION 'PLAN_ALREADY_PURCHASED';
  END IF;

  INSERT INTO public.transactions (user_id, plan_id, amount_cents, tokens, currency, payment_method, status)
    VALUES (_user_id, _p.id, _p.price_cents, _p.tokens, _p.currency, COALESCE(_payment_method, 'pendiente'), 'completed')
    RETURNING id INTO _tx;

  INSERT INTO public.token_ledger (user_id, delta, reason, transaction_id, created_by)
    VALUES (_user_id, _p.tokens, 'Compra en estudio: ' || _p.name, _tx, auth.uid());

  RETURN _tx;
END; $$;

REVOKE ALL ON FUNCTION public.admin_purchase_plan(uuid, uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_purchase_plan(uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.purchase_plan(_plan_id uuid, _payment_method text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid(); _p public.token_plans; _tx uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  SELECT * INTO _p FROM public.token_plans WHERE id = _plan_id AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'PLAN_NOT_FOUND'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(_uid::text || ':' || _plan_id::text, 0));

  IF _p.purchasable_once AND EXISTS (
    SELECT 1 FROM public.transactions
    WHERE user_id = _uid AND plan_id = _plan_id AND status = 'completed'
  ) THEN
    RAISE EXCEPTION 'PLAN_ALREADY_PURCHASED';
  END IF;

  INSERT INTO public.transactions (user_id, plan_id, amount_cents, tokens, currency, payment_method, status)
    VALUES (_uid, _p.id, _p.price_cents, _p.tokens, _p.currency, COALESCE(_payment_method,'pendiente'), 'completed')
    RETURNING id INTO _tx;

  INSERT INTO public.token_ledger (user_id, delta, reason, transaction_id)
    VALUES (_uid, _p.tokens, 'Compra: ' || _p.name, _tx);

  RETURN _tx;
END; $$;

REVOKE ALL ON FUNCTION public.purchase_plan(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_plan(uuid, text) TO service_role;