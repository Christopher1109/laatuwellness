-- Inicio de vigencia diferido para membresías.
--
-- Problema: una membresía (ej. Founders Access) vendida antes de que arranquen
-- las clases empezaba a correr desde el día del pago, así que el cliente
-- perdía días sin poder tomar clase. Ahora cada plan puede tener una fecha
-- mínima de inicio: si se compra antes, los 30 días cuentan desde esa fecha.

-- 1) Nueva columna en el plan.
ALTER TABLE public.token_plans
  ADD COLUMN IF NOT EXISTS membership_starts_at timestamptz;

COMMENT ON COLUMN public.token_plans.membership_starts_at IS
  'Si se compra antes de esta fecha, la vigencia empieza a contar aquí y no el día del pago.';

-- 2) Trigger que calcula la ventana de acceso de cada compra.
CREATE OR REPLACE FUNCTION public.trg_set_membership_access()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _p public.token_plans; _prev timestamptz; _start timestamptz;
BEGIN
  IF NEW.plan_id IS NULL OR NEW.status <> 'completed' OR NEW.access_ends_at IS NOT NULL THEN RETURN NEW; END IF;
  SELECT * INTO _p FROM public.token_plans WHERE id = NEW.plan_id;
  IF NOT FOUND OR _p.daily_class_limit IS NULL THEN RETURN NEW; END IF;
  IF _p.renews_plan_id IS NOT NULL THEN
    SELECT max(t.access_ends_at) INTO _prev FROM public.transactions t
     WHERE t.user_id = NEW.user_id AND t.status = 'completed' AND t.plan_id IN (_p.renews_plan_id, _p.id);
  END IF;
  IF _prev IS NOT NULL AND _prev > now() - interval '1 day' THEN
    -- Renovación encadenada: empieza justo al terminar el periodo anterior.
    NEW.access_starts_at := _prev + interval '1 second';
    NEW.access_ends_at := public.membership_end(_prev + interval '1 second', coalesce(_p.validity_days, 180));
  ELSE
    _start := greatest(coalesce(NEW.created_at, now()), coalesce(_p.membership_starts_at, '-infinity'::timestamptz));
    NEW.access_starts_at := _start;
    NEW.access_ends_at := public.membership_end(_start, coalesce(_p.validity_days, 30));
  END IF;
  RETURN NEW;
END; $function$;

-- 3) Lotes de créditos con vigencia: misma regla (por si un paquete con
--    créditos usa la fecha de inicio).
CREATE OR REPLACE FUNCTION public.trg_ledger_to_lots()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _need int; _lot record; _take int; _days int; _plan text; _from timestamptz;
BEGIN
  IF NEW.delta = 0 THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('lots:' || NEW.user_id::text, 0));
  IF NEW.delta > 0 THEN
    IF NEW.transaction_id IS NOT NULL THEN
      SELECT p.validity_days, p.name, p.membership_starts_at INTO _days, _plan, _from FROM public.transactions t
        LEFT JOIN public.token_plans p ON p.id = t.plan_id WHERE t.id = NEW.transaction_id;
      INSERT INTO public.credit_lots (user_id, transaction_id, label, granted, remaining, expires_at)
      VALUES (NEW.user_id, NEW.transaction_id, coalesce(_plan, NEW.reason), NEW.delta, NEW.delta,
              CASE WHEN _days IS NOT NULL THEN
                public.membership_end(greatest(NEW.created_at, coalesce(_from, '-infinity'::timestamptz)), _days)
              END);
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
END; $function$;

-- 4) Estado de membresía: además de la activa, devuelve la que está por
--    iniciar (comprada antes de la fecha de arranque), con su fecha de inicio.
CREATE OR REPLACE FUNCTION public.membership_status(_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _t record; _used int; _renew record; _latest timestamptz; _upcoming boolean := false;
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
  IF NOT FOUND THEN
    SELECT t.access_starts_at, t.access_ends_at, p.id AS plan_id, p.name, p.daily_class_limit, coalesce(p.renews_plan_id, p.id) AS family
      INTO _t
      FROM public.transactions t JOIN public.token_plans p ON p.id = t.plan_id
     WHERE t.user_id = _user_id AND t.status = 'completed' AND p.daily_class_limit IS NOT NULL
       AND t.access_starts_at > now()
     ORDER BY t.access_starts_at ASC LIMIT 1;
    IF NOT FOUND THEN RETURN NULL; END IF;
    _upcoming := true;
  END IF;
  SELECT count(*) INTO _used FROM public.bookings b JOIN public.classes c ON c.id = b.class_id
   WHERE b.user_id = _user_id AND b.status = 'reservada' AND b.tokens_spent = 0
     AND (c.starts_at AT TIME ZONE 'America/Monterrey')::date = (now() AT TIME ZONE 'America/Monterrey')::date;
  SELECT max(t.access_ends_at) INTO _latest FROM public.transactions t JOIN public.token_plans p ON p.id = t.plan_id
   WHERE t.user_id = _user_id AND t.status = 'completed' AND coalesce(p.renews_plan_id, p.id) = _t.family;
  SELECT id, name, price_cents INTO _renew FROM public.token_plans WHERE renews_plan_id = _t.family AND active LIMIT 1;
  RETURN jsonb_build_object(
    'plan_id', _t.plan_id, 'plan_name', _t.name, 'daily_limit', _t.daily_class_limit,
    'starts_at', _t.access_starts_at, 'upcoming', _upcoming,
    'ends_at', _latest, 'used_today', CASE WHEN _upcoming THEN 0 ELSE _used END,
    'renewal_plan_id', CASE WHEN NOT _upcoming AND _renew.id IS NOT NULL AND _latest <= now() + interval '5 days' THEN _renew.id END,
    'renewal_plan_name', _renew.name, 'renewal_price_cents', _renew.price_cents);
END; $function$;

-- 5) Arranque de clases: lunes 26 de octubre de 2026 (hora de Monterrey).
UPDATE public.token_plans
   SET membership_starts_at = '2026-10-26 00:00:00-06'
 WHERE name IN ('Founders Access', 'The Everyday', 'Two a Day')
   AND renews_plan_id IS NULL;

-- 6) Corrige las compras ya hechas que empezaron a correr antes del arranque.
UPDATE public.transactions t
   SET access_starts_at = p.membership_starts_at,
       access_ends_at = public.membership_end(p.membership_starts_at, coalesce(p.validity_days, 30))
  FROM public.token_plans p
 WHERE p.id = t.plan_id
   AND t.status = 'completed'
   AND p.renews_plan_id IS NULL
   AND p.daily_class_limit IS NOT NULL
   AND p.membership_starts_at IS NOT NULL
   AND t.access_starts_at < p.membership_starts_at;
