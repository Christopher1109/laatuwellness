ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS access_starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS access_ends_at timestamptz;
ALTER TABLE public.token_plans
  ADD COLUMN IF NOT EXISTS renews_plan_id uuid REFERENCES public.token_plans(id);

-- Fin de vigencia: N días naturales desde la fecha de inicio, a las 23:59:59 de Monterrey
-- (ej. comprada 14 oct, 30 días -> 13 nov 23:59:59).
CREATE OR REPLACE FUNCTION public.membership_end(_start timestamptz, _days int)
RETURNS timestamptz LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT (((_start AT TIME ZONE 'America/Monterrey')::date + (_days - 1)) + time '23:59:59') AT TIME ZONE 'America/Monterrey'
$$;

CREATE OR REPLACE FUNCTION public.trg_set_membership_access()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _p public.token_plans; _prev timestamptz;
BEGIN
  IF NEW.plan_id IS NULL OR NEW.status <> 'completed' OR NEW.access_ends_at IS NOT NULL THEN RETURN NEW; END IF;
  SELECT * INTO _p FROM public.token_plans WHERE id = NEW.plan_id;
  IF NOT FOUND OR _p.daily_class_limit IS NULL THEN RETURN NEW; END IF;
  IF _p.renews_plan_id IS NOT NULL THEN
    SELECT max(t.access_ends_at) INTO _prev FROM public.transactions t
     WHERE t.user_id = NEW.user_id AND t.status = 'completed' AND t.plan_id IN (_p.renews_plan_id, _p.id);
  END IF;
  IF _prev IS NOT NULL AND _prev > now() - interval '1 day' THEN
    NEW.access_starts_at := _prev + interval '1 second';
    NEW.access_ends_at := public.membership_end(_prev + interval '1 second', coalesce(_p.validity_days, 180));
  ELSE
    NEW.access_starts_at := coalesce(NEW.created_at, now());
    NEW.access_ends_at := public.membership_end(coalesce(NEW.created_at, now()), coalesce(_p.validity_days, 30));
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS set_membership_access ON public.transactions;
CREATE TRIGGER set_membership_access BEFORE INSERT OR UPDATE OF status ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.trg_set_membership_access();

UPDATE public.transactions t SET access_starts_at = t.created_at,
  access_ends_at = public.membership_end(t.created_at, coalesce(p.validity_days, 30))
FROM public.token_plans p
WHERE p.id = t.plan_id AND p.daily_class_limit IS NOT NULL AND t.status = 'completed' AND t.access_ends_at IS NULL;

CREATE OR REPLACE FUNCTION public.user_daily_class_limit(_user_id uuid, _at timestamptz)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT max(p.daily_class_limit)::int
  FROM public.transactions t JOIN public.token_plans p ON p.id = t.plan_id
  WHERE t.user_id = _user_id AND t.status = 'completed' AND p.daily_class_limit IS NOT NULL
    AND _at BETWEEN t.access_starts_at AND t.access_ends_at
$$;

CREATE OR REPLACE FUNCTION public.has_active_membership(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.transactions t JOIN public.token_plans p ON p.id = t.plan_id
    WHERE t.user_id = _user_id AND t.status = 'completed'
      AND ((t.access_ends_at IS NOT NULL AND now() BETWEEN t.access_starts_at AND t.access_ends_at)
        OR (t.access_ends_at IS NULL AND p.recurring AND t.created_at + make_interval(days => coalesce(p.validity_days, 30)) >= now()))
  )
$$;

-- Estado de la membresía para mostrar al cliente (sin créditos) y al staff.
CREATE OR REPLACE FUNCTION public.membership_status(_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _t record; _used int; _family uuid; _renew record; _latest timestamptz;
BEGIN
  IF auth.uid() IS NULL OR (auth.uid() <> _user_id AND NOT (public.has_role(auth.uid(), 'admin') OR public.is_staff(auth.uid()))) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  SELECT t.access_starts_at, t.access_ends_at, p.id AS plan_id, p.name, p.daily_class_limit, coalesce(p.renews_plan_id, p.id) AS family
    INTO _t
    FROM public.transactions t JOIN public.token_plans p ON p.id = t.plan_id
   WHERE t.user_id = _user_id AND t.status = 'completed' AND p.daily_class_limit IS NOT NULL
     AND now() BETWEEN t.access_starts_at AND t.access_ends_at
   ORDER BY t.access_ends_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT count(*) INTO _used FROM public.bookings b JOIN public.classes c ON c.id = b.class_id
   WHERE b.user_id = _user_id AND b.status = 'reservada'
     AND (c.starts_at AT TIME ZONE 'America/Monterrey')::date = (now() AT TIME ZONE 'America/Monterrey')::date;
  SELECT max(t.access_ends_at) INTO _latest FROM public.transactions t JOIN public.token_plans p ON p.id = t.plan_id
   WHERE t.user_id = _user_id AND t.status = 'completed' AND coalesce(p.renews_plan_id, p.id) = _t.family;
  SELECT id, name, price_cents INTO _renew FROM public.token_plans
   WHERE renews_plan_id = _t.family AND active LIMIT 1;
  RETURN jsonb_build_object(
    'plan_id', _t.plan_id, 'plan_name', _t.name, 'daily_limit', _t.daily_class_limit,
    'ends_at', _latest, 'used_today', _used,
    'renewal_plan_id', CASE WHEN _renew.id IS NOT NULL AND _latest <= now() + interval '5 days' THEN _renew.id END,
    'renewal_plan_name', _renew.name, 'renewal_price_cents', _renew.price_cents);
END; $$;
GRANT EXECUTE ON FUNCTION public.membership_status(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.plan_purchase_block_reason(_user_id uuid, _plan_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE _p public.token_plans; _latest timestamptz;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> _user_id
     AND NOT (public.has_role(auth.uid(), 'admin') OR public.is_staff(auth.uid())) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  SELECT * INTO _p FROM public.token_plans WHERE id = _plan_id;
  IF NOT FOUND OR NOT _p.active THEN RETURN 'PLAN_NOT_AVAILABLE'; END IF;
  IF _p.renews_plan_id IS NOT NULL THEN
    SELECT max(t.access_ends_at) INTO _latest FROM public.transactions t
     WHERE t.user_id = _user_id AND t.status = 'completed' AND t.plan_id IN (_p.renews_plan_id, _p.id);
    IF _latest IS NULL THEN RETURN 'RENEWAL_NOT_ELIGIBLE'; END IF;
    IF _latest < now() THEN RETURN 'RENEWAL_EXPIRED'; END IF;
    IF _latest > now() + interval '5 days' THEN RETURN 'RENEWAL_TOO_EARLY'; END IF;
    RETURN NULL;
  END IF;
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

-- Reservas: si la membresía vigente cubre el día de la clase, no se cobran créditos.
CREATE OR REPLACE FUNCTION public.book_class(_class_id uuid, _seat integer DEFAULT NULL::integer)
RETURNS bookings LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _uid uuid := auth.uid(); _c public.classes; _b public.bookings; _taken int; _bal int; _seat int := _seat; _cost int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO _c FROM public.classes WHERE id = _class_id AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'CLASS_NOT_FOUND'; END IF;
  IF _c.starts_at <= now() THEN RAISE EXCEPTION 'CLASS_PAST'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.waiver_signatures WHERE user_id = _uid) THEN RAISE EXCEPTION 'WAIVER_REQUIRED'; END IF;
  SELECT count(*) INTO _taken FROM public.bookings WHERE class_id = _class_id AND status = 'reservada';
  IF _taken >= _c.capacity THEN RAISE EXCEPTION 'CLASS_FULL'; END IF;
  IF EXISTS (SELECT 1 FROM public.bookings WHERE class_id = _class_id AND user_id = _uid AND status = 'reservada') THEN RAISE EXCEPTION 'ALREADY_BOOKED'; END IF;
  IF _seat IS NOT NULL AND EXISTS (SELECT 1 FROM public.bookings WHERE class_id = _class_id AND seat_number = _seat AND status = 'reservada') THEN RAISE EXCEPTION 'SEAT_TAKEN'; END IF;
  IF _seat IS NULL THEN
    SELECT MIN(s) INTO _seat FROM generate_series(1, _c.capacity) s
      WHERE s NOT IN (SELECT seat_number FROM public.bookings WHERE class_id = _class_id AND status = 'reservada' AND seat_number IS NOT NULL);
  END IF;
  _cost := CASE WHEN public.user_daily_class_limit(_uid, _c.starts_at) IS NOT NULL THEN 0 ELSE _c.tokens_cost END;
  SELECT public.token_balance(_uid) INTO _bal;
  IF _bal < _cost THEN RAISE EXCEPTION 'INSUFFICIENT_TOKENS'; END IF;
  INSERT INTO public.bookings (user_id, class_id, tokens_spent, seat_number) VALUES (_uid, _class_id, _cost, _seat)
    ON CONFLICT (user_id, class_id) DO UPDATE SET status = 'reservada', tokens_spent = _cost, seat_number = _seat
    RETURNING * INTO _b;
  IF _cost > 0 THEN
    INSERT INTO public.token_ledger (user_id, delta, reason) VALUES (_uid, -_cost, 'Reserva de clase');
  END IF;
  RETURN _b;
END; $function$;

CREATE OR REPLACE FUNCTION public.book_class(_class_id uuid)
RETURNS bookings LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.book_class(_class_id, NULL::integer)
$$;

CREATE OR REPLACE FUNCTION public.admin_book_class(_user_id uuid, _class_id uuid, _seat integer DEFAULT NULL::integer)
RETURNS bookings LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _c public.classes; _b public.bookings; _taken int; _bal int; _seat int := _seat; _cost int;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.is_staff(auth.uid())) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO _c FROM public.classes WHERE id = _class_id AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'CLASS_NOT_FOUND'; END IF;
  SELECT count(*) INTO _taken FROM public.bookings WHERE class_id = _class_id AND status = 'reservada';
  IF _taken >= _c.capacity THEN RAISE EXCEPTION 'CLASS_FULL'; END IF;
  IF EXISTS (SELECT 1 FROM public.bookings WHERE class_id = _class_id AND user_id = _user_id AND status = 'reservada') THEN RAISE EXCEPTION 'ALREADY_BOOKED'; END IF;
  IF _seat IS NOT NULL AND EXISTS (SELECT 1 FROM public.bookings WHERE class_id = _class_id AND seat_number = _seat AND status = 'reservada') THEN RAISE EXCEPTION 'SEAT_TAKEN'; END IF;
  IF _seat IS NULL THEN
    SELECT MIN(s) INTO _seat FROM generate_series(1, _c.capacity) s
      WHERE s NOT IN (SELECT seat_number FROM public.bookings WHERE class_id = _class_id AND status = 'reservada' AND seat_number IS NOT NULL);
  END IF;
  _cost := CASE WHEN public.user_daily_class_limit(_user_id, _c.starts_at) IS NOT NULL THEN 0 ELSE _c.tokens_cost END;
  SELECT public.token_balance(_user_id) INTO _bal;
  IF _bal < _cost THEN RAISE EXCEPTION 'INSUFFICIENT_TOKENS'; END IF;
  INSERT INTO public.bookings (user_id, class_id, tokens_spent, seat_number) VALUES (_user_id, _class_id, _cost, _seat)
    ON CONFLICT (user_id, class_id) DO UPDATE SET status = 'reservada', tokens_spent = _cost, seat_number = _seat
    RETURNING * INTO _b;
  IF _cost > 0 THEN
    INSERT INTO public.token_ledger (user_id, delta, reason, created_by) VALUES (_user_id, -_cost, 'Reserva registrada por staff', auth.uid());
  END IF;
  RETURN _b;
END; $function$;