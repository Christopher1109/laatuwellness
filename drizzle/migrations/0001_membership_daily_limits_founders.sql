ALTER TABLE public.token_plans
  ADD COLUMN IF NOT EXISTS daily_class_limit integer,
  ADD COLUMN IF NOT EXISTS available_from timestamptz,
  ADD COLUMN IF NOT EXISTS available_until timestamptz,
  ADD COLUMN IF NOT EXISTS max_sales integer,
  ADD COLUMN IF NOT EXISTS compare_at_price_cents integer,
  ADD COLUMN IF NOT EXISTS is_promo boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.plan_sales_count(_plan_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int FROM public.transactions WHERE plan_id = _plan_id AND status = 'completed'
$$;
GRANT EXECUTE ON FUNCTION public.plan_sales_count(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.plan_purchase_block_reason(_user_id uuid, _plan_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE _p public.token_plans;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> _user_id
     AND NOT (public.has_role(auth.uid(), 'admin') OR public.is_staff(auth.uid())) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  SELECT * INTO _p FROM public.token_plans WHERE id = _plan_id;
  IF NOT FOUND OR NOT _p.active THEN RETURN 'PLAN_NOT_AVAILABLE'; END IF;
  IF _p.available_from IS NOT NULL AND now() < _p.available_from THEN RETURN 'PLAN_NOT_YET_AVAILABLE'; END IF;
  IF _p.available_until IS NOT NULL AND now() > _p.available_until THEN RETURN 'PLAN_EXPIRED'; END IF;
  IF _p.max_sales IS NOT NULL AND public.plan_sales_count(_plan_id) >= _p.max_sales THEN RETURN 'PLAN_SOLD_OUT'; END IF;
  IF _p.purchasable_once AND EXISTS (
    SELECT 1 FROM public.transactions WHERE user_id = _user_id AND plan_id = _plan_id AND status = 'completed'
  ) THEN RETURN 'PLAN_ALREADY_PURCHASED'; END IF;
  IF _p.new_clients_only AND EXISTS (
    SELECT 1 FROM public.transactions WHERE user_id = _user_id AND status = 'completed'
  ) THEN RETURN 'NEW_CLIENTS_ONLY'; END IF;
  RETURN NULL;
END; $function$;

-- Cupo máximo: se valida en toda venta (en línea, POS, staff). Un pago en
-- línea que llegó tarde (webhook) dentro de 1 hora tras el cierre se respeta.
CREATE OR REPLACE FUNCTION public.trg_enforce_plan_limits()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _p public.token_plans;
BEGIN
  IF NEW.plan_id IS NULL OR NEW.status <> 'completed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'completed' THEN RETURN NEW; END IF;
  SELECT * INTO _p FROM public.token_plans WHERE id = NEW.plan_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF _p.max_sales IS NULL AND _p.available_until IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('plan_sales:' || NEW.plan_id::text, 0));
  IF _p.available_until IS NOT NULL AND now() > _p.available_until + interval '1 hour' THEN
    RAISE EXCEPTION 'PLAN_EXPIRED';
  END IF;
  IF _p.max_sales IS NOT NULL AND (
    SELECT count(*) FROM public.transactions WHERE plan_id = NEW.plan_id AND status = 'completed' AND id <> NEW.id
  ) >= _p.max_sales THEN
    RAISE EXCEPTION 'PLAN_SOLD_OUT';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS enforce_plan_limits ON public.transactions;
CREATE TRIGGER enforce_plan_limits BEFORE INSERT OR UPDATE OF status ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_plan_limits();

-- Límite de clases por día según la membresía vigente del cliente.
CREATE OR REPLACE FUNCTION public.user_daily_class_limit(_user_id uuid, _at timestamptz)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT max(p.daily_class_limit)::int
  FROM public.transactions t JOIN public.token_plans p ON p.id = t.plan_id
  WHERE t.user_id = _user_id AND t.status = 'completed' AND p.daily_class_limit IS NOT NULL
    AND t.created_at <= _at
    AND t.created_at + make_interval(days => coalesce(p.validity_days, 30)) >= _at
$$;

CREATE OR REPLACE FUNCTION public.trg_enforce_daily_class_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _start timestamptz; _limit int; _day date; _count int;
BEGIN
  IF NEW.status <> 'reservada' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'reservada' THEN RETURN NEW; END IF;
  SELECT starts_at INTO _start FROM public.classes WHERE id = NEW.class_id;
  _limit := public.user_daily_class_limit(NEW.user_id, _start);
  IF _limit IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('daily_limit:' || NEW.user_id::text, 0));
  _day := (_start AT TIME ZONE 'America/Monterrey')::date;
  SELECT count(*) INTO _count FROM public.bookings b JOIN public.classes c ON c.id = b.class_id
   WHERE b.user_id = NEW.user_id AND b.status = 'reservada' AND b.id <> NEW.id
     AND (c.starts_at AT TIME ZONE 'America/Monterrey')::date = _day;
  IF _count >= _limit THEN RAISE EXCEPTION 'DAILY_LIMIT_REACHED'; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS enforce_daily_class_limit ON public.bookings;
CREATE TRIGGER enforce_daily_class_limit BEFORE INSERT OR UPDATE OF status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_daily_class_limit();