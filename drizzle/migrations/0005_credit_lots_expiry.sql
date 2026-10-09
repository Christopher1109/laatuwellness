CREATE TABLE public.credit_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  transaction_id uuid,
  label text NOT NULL DEFAULT '',
  granted integer NOT NULL,
  remaining integer NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX credit_lots_user_idx ON public.credit_lots (user_id, expires_at);
GRANT SELECT ON public.credit_lots TO authenticated;
GRANT ALL ON public.credit_lots TO service_role;
ALTER TABLE public.credit_lots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own or staff read credit lots" ON public.credit_lots FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.is_staff(auth.uid()));

-- Respaldo: saldo actual de cada cliente como lote sin vencimiento (compras previas).
INSERT INTO public.credit_lots (user_id, label, granted, remaining, expires_at)
SELECT user_id, 'Saldo anterior', sum(delta), sum(delta), NULL
FROM public.token_ledger GROUP BY user_id HAVING sum(delta) > 0;

-- Cada movimiento del ledger alimenta los lotes:
--  +compra (con transaction_id): lote nuevo con la vigencia del paquete.
--  +devolución/ajuste: primero regresa a lotes vigentes ya usados, si no, lote sin vencimiento.
--  -consumo: se descuenta primero del lote que vence antes.
CREATE OR REPLACE FUNCTION public.trg_ledger_to_lots()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _need int; _lot record; _take int; _days int; _plan text;
BEGIN
  IF NEW.delta = 0 THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('lots:' || NEW.user_id::text, 0));
  IF NEW.delta > 0 THEN
    IF NEW.transaction_id IS NOT NULL THEN
      SELECT p.validity_days, p.name INTO _days, _plan FROM public.transactions t
        LEFT JOIN public.token_plans p ON p.id = t.plan_id WHERE t.id = NEW.transaction_id;
      INSERT INTO public.credit_lots (user_id, transaction_id, label, granted, remaining, expires_at)
      VALUES (NEW.user_id, NEW.transaction_id, coalesce(_plan, NEW.reason), NEW.delta, NEW.delta,
              CASE WHEN _days IS NOT NULL THEN public.membership_end(NEW.created_at, _days) END);
      RETURN NEW;
    END IF;
    _need := NEW.delta;
    FOR _lot IN SELECT * FROM public.credit_lots
      WHERE user_id = NEW.user_id AND remaining < granted AND (expires_at IS NULL OR expires_at > now())
      ORDER BY expires_at NULLS LAST, created_at FOR UPDATE LOOP
      EXIT WHEN _need <= 0;
      _take := least(_need, _lot.granted - _lot.remaining);
      UPDATE public.credit_lots SET remaining = remaining + _take WHERE id = _lot.id;
      _need := _need - _take;
    END LOOP;
    IF _need > 0 THEN
      INSERT INTO public.credit_lots (user_id, label, granted, remaining)
      VALUES (NEW.user_id, NEW.reason, _need, _need);
    END IF;
  ELSE
    _need := -NEW.delta;
    FOR _lot IN SELECT * FROM public.credit_lots
      WHERE user_id = NEW.user_id AND remaining > 0 AND (expires_at IS NULL OR expires_at > now())
      ORDER BY expires_at NULLS LAST, created_at FOR UPDATE LOOP
      EXIT WHEN _need <= 0;
      _take := least(_need, _lot.remaining);
      UPDATE public.credit_lots SET remaining = remaining - _take WHERE id = _lot.id;
      _need := _need - _take;
    END LOOP;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER ledger_to_lots AFTER INSERT ON public.token_ledger
  FOR EACH ROW EXECUTE FUNCTION public.trg_ledger_to_lots();

-- Saldo = créditos vigentes (los vencidos se pierden, no se acumulan).
CREATE OR REPLACE FUNCTION public.token_balance(_user_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(sum(remaining), 0)::int FROM public.credit_lots
  WHERE user_id = _user_id AND remaining > 0 AND (expires_at IS NULL OR expires_at > now())
$$;

-- Límite diario: solo cuentan las reservas hechas con la membresía (sin créditos).
CREATE OR REPLACE FUNCTION public.trg_enforce_daily_class_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _start timestamptz; _limit int; _day date; _count int;
BEGIN
  IF NEW.status <> 'reservada' OR NEW.tokens_spent > 0 THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'reservada' THEN RETURN NEW; END IF;
  SELECT starts_at INTO _start FROM public.classes WHERE id = NEW.class_id;
  _limit := public.user_daily_class_limit(NEW.user_id, _start);
  IF _limit IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('daily_limit:' || NEW.user_id::text, 0));
  _day := (_start AT TIME ZONE 'America/Monterrey')::date;
  SELECT count(*) INTO _count FROM public.bookings b JOIN public.classes c ON c.id = b.class_id
   WHERE b.user_id = NEW.user_id AND b.status = 'reservada' AND b.tokens_spent = 0 AND b.id <> NEW.id
     AND (c.starts_at AT TIME ZONE 'America/Monterrey')::date = _day;
  IF _count >= _limit THEN RAISE EXCEPTION 'DAILY_LIMIT_REACHED'; END IF;
  RETURN NEW;
END; $$;

-- Membresía usada en un día dado (para decidir si se puede reservar con ella).
CREATE OR REPLACE FUNCTION public.membership_day_usage(_user_id uuid, _at timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _limit int; _used int;
BEGIN
  IF auth.uid() IS NULL OR (auth.uid() <> _user_id AND NOT (public.has_role(auth.uid(), 'admin') OR public.is_staff(auth.uid()))) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  _limit := public.user_daily_class_limit(_user_id, _at);
  IF _limit IS NULL THEN RETURN NULL; END IF;
  SELECT count(*) INTO _used FROM public.bookings b JOIN public.classes c ON c.id = b.class_id
   WHERE b.user_id = _user_id AND b.status = 'reservada' AND b.tokens_spent = 0
     AND (c.starts_at AT TIME ZONE 'America/Monterrey')::date = (_at AT TIME ZONE 'America/Monterrey')::date;
  RETURN jsonb_build_object('daily_limit', _limit, 'used', _used);
END; $$;
GRANT EXECUTE ON FUNCTION public.membership_day_usage(uuid, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.membership_status(_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _t record; _used int; _renew record; _latest timestamptz;
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
   WHERE b.user_id = _user_id AND b.status = 'reservada' AND b.tokens_spent = 0
     AND (c.starts_at AT TIME ZONE 'America/Monterrey')::date = (now() AT TIME ZONE 'America/Monterrey')::date;
  SELECT max(t.access_ends_at) INTO _latest FROM public.transactions t JOIN public.token_plans p ON p.id = t.plan_id
   WHERE t.user_id = _user_id AND t.status = 'completed' AND coalesce(p.renews_plan_id, p.id) = _t.family;
  SELECT id, name, price_cents INTO _renew FROM public.token_plans WHERE renews_plan_id = _t.family AND active LIMIT 1;
  RETURN jsonb_build_object(
    'plan_id', _t.plan_id, 'plan_name', _t.name, 'daily_limit', _t.daily_class_limit,
    'ends_at', _latest, 'used_today', _used,
    'renewal_plan_id', CASE WHEN _renew.id IS NOT NULL AND _latest <= now() + interval '5 days' THEN _renew.id END,
    'renewal_plan_name', _renew.name, 'renewal_price_cents', _renew.price_cents);
END; $$;

-- Reserva eligiendo cómo pagar: membresía (por defecto si cubre) o créditos de paquete.
DROP FUNCTION IF EXISTS public.book_class(uuid, integer);
CREATE OR REPLACE FUNCTION public.book_class(_class_id uuid, _seat integer DEFAULT NULL::integer, _use_credits boolean DEFAULT false)
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
  _cost := CASE WHEN NOT _use_credits AND public.user_daily_class_limit(_uid, _c.starts_at) IS NOT NULL THEN 0
                ELSE greatest(_c.tokens_cost, 1) END;
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
  SELECT public.book_class(_class_id, NULL::integer, false)
$$;
GRANT EXECUTE ON FUNCTION public.book_class(uuid, integer, boolean) TO authenticated;