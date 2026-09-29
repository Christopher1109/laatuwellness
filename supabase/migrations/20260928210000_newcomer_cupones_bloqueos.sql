-- ============================================================================
-- 1) Newcomer: solo para clientes nuevos, una compra por cuenta, 2 créditos.
-- 2) Cupones: límite total de usos + límite de usos por cliente + opción de
--    "solo clientes nuevos" (configurables desde Admin > Cupones).
-- 3) Programación: bloquear UN bloque (día + hora) de UNA semana sin tocar el
--    patrón del mes. "Actualizar clases" respeta esos bloqueos.
-- 4) POS: la venta de paquetes en efectivo valida las mismas reglas, y los
--    convenios ($0, Wellhub/TotalPass) se registran como 'convenio'.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Newcomer
-- ---------------------------------------------------------------------------
ALTER TABLE public.token_plans ADD COLUMN IF NOT EXISTS purchasable_once boolean NOT NULL DEFAULT false;
ALTER TABLE public.token_plans ADD COLUMN IF NOT EXISTS new_clients_only boolean NOT NULL DEFAULT false;

UPDATE public.token_plans
SET purchasable_once = true,
    new_clients_only = true,
    tokens = 2
WHERE name = 'Newcomer';

-- Razón por la que un cliente NO puede comprar un paquete (NULL = sí puede).
-- La usan la página web, la app y el punto de venta antes de cobrar.
CREATE OR REPLACE FUNCTION public.plan_purchase_block_reason(_user_id uuid, _plan_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _p public.token_plans;
BEGIN
  -- Un cliente solo puede consultar su propia cuenta; staff/admin cualquiera.
  IF auth.uid() IS NOT NULL AND auth.uid() <> _user_id
     AND NOT (public.has_role(auth.uid(), 'admin') OR public.is_staff(auth.uid())) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT * INTO _p FROM public.token_plans WHERE id = _plan_id;
  IF NOT FOUND OR NOT _p.active THEN RETURN 'PLAN_NOT_AVAILABLE'; END IF;

  IF _p.purchasable_once AND EXISTS (
    SELECT 1 FROM public.transactions
    WHERE user_id = _user_id AND plan_id = _plan_id AND status = 'completed'
  ) THEN
    RETURN 'PLAN_ALREADY_PURCHASED';
  END IF;

  IF _p.new_clients_only AND EXISTS (
    SELECT 1 FROM public.transactions
    WHERE user_id = _user_id AND status = 'completed'
  ) THEN
    RETURN 'NEW_CLIENTS_ONLY';
  END IF;

  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.plan_purchase_block_reason(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.plan_purchase_block_reason(uuid, uuid) TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 4) POS: paquetes en efectivo (reemplaza la versión anterior)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pos_sell_plans_cash(_user_id uuid, _plans jsonb)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _item jsonb;
  _n int;
  _count int := 0;
  _batch text := gen_random_uuid()::text;
  _reason text;
  _price int;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.is_staff(auth.uid())) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF _user_id IS NULL THEN RAISE EXCEPTION 'PLAN_SALE_REQUIRES_CLIENT'; END IF;

  FOR _item IN SELECT * FROM jsonb_array_elements(_plans) LOOP
    _reason := public.plan_purchase_block_reason(_user_id, (_item->>'plan_id')::uuid);
    IF _reason IS NOT NULL THEN RAISE EXCEPTION '%', _reason; END IF;
    IF (_item->>'qty')::int > 1 AND EXISTS (
      SELECT 1 FROM public.token_plans
      WHERE id = (_item->>'plan_id')::uuid AND (purchasable_once OR new_clients_only)
    ) THEN
      RAISE EXCEPTION 'PLAN_ONLY_ONE';
    END IF;
    SELECT price_cents INTO _price FROM public.token_plans WHERE id = (_item->>'plan_id')::uuid;

    FOR _n IN 1..greatest((_item->>'qty')::int, 1) LOOP
      PERFORM public.fulfill_plan_purchase(
        _user_id,
        (_item->>'plan_id')::uuid,
        'pos_cash_' || _batch || '_' || (_item->>'plan_id') || '_' || _n::text,
        CASE WHEN _price = 0 THEN 'convenio' ELSE 'efectivo' END
      );
      _count := _count + 1;
    END LOOP;
  END LOOP;
  RETURN _count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.pos_sell_plans_cash(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.pos_sell_plans_cash(uuid, jsonb) TO authenticated;


-- ---------------------------------------------------------------------------
-- 2) Cupones
-- ---------------------------------------------------------------------------
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS max_uses_per_user int DEFAULT 1; -- NULL = sin límite
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS new_clients_only boolean NOT NULL DEFAULT false;
ALTER TABLE public.coupons DROP CONSTRAINT IF EXISTS coupons_max_uses_per_user_check;
ALTER TABLE public.coupons ADD CONSTRAINT coupons_max_uses_per_user_check
  CHECK (max_uses_per_user IS NULL OR max_uses_per_user > 0);

-- Antes una persona solo podía usar cada cupón una vez (restricción fija).
-- Ahora el límite por persona lo decide max_uses_per_user.
ALTER TABLE public.coupon_redemptions DROP CONSTRAINT IF EXISTS coupon_redemptions_coupon_id_user_id_key;
CREATE INDEX IF NOT EXISTS coupon_redemptions_coupon_user_idx
  ON public.coupon_redemptions (coupon_id, user_id);

CREATE OR REPLACE FUNCTION public.redeem_coupon(_code text)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _c public.coupons;
  _mine int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  SELECT * INTO _c FROM public.coupons
    WHERE upper(code) = upper(trim(_code)) AND active
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'COUPON_NOT_FOUND'; END IF;

  IF _c.max_uses IS NOT NULL AND _c.times_used >= _c.max_uses THEN
    RAISE EXCEPTION 'COUPON_EXHAUSTED';
  END IF;

  SELECT count(*) INTO _mine FROM public.coupon_redemptions
    WHERE coupon_id = _c.id AND user_id = _uid;
  IF _c.max_uses_per_user IS NOT NULL AND _mine >= _c.max_uses_per_user THEN
    RAISE EXCEPTION 'COUPON_ALREADY_USED';
  END IF;

  IF _c.new_clients_only AND EXISTS (
    SELECT 1 FROM public.transactions WHERE user_id = _uid AND status = 'completed'
  ) THEN
    RAISE EXCEPTION 'COUPON_NEW_CLIENTS_ONLY';
  END IF;

  INSERT INTO public.coupon_redemptions (coupon_id, user_id) VALUES (_c.id, _uid);
  UPDATE public.coupons SET times_used = times_used + 1 WHERE id = _c.id;
  INSERT INTO public.token_ledger (user_id, delta, reason)
    VALUES (_uid, _c.reward_tokens, 'Cupón: ' || _c.code);

  RETURN _c.reward_tokens;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.redeem_coupon(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.redeem_coupon(text) TO authenticated;


-- ---------------------------------------------------------------------------
-- 3) Bloquear un solo bloque de una semana
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.schedule_slot_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_key text NOT NULL,
  day date NOT NULL,
  start_time time NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (module_key, day, start_time)
);
GRANT SELECT ON public.schedule_slot_blocks TO authenticated;
GRANT ALL ON public.schedule_slot_blocks TO service_role;
ALTER TABLE public.schedule_slot_blocks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "schedule_slot_blocks_staff_select" ON public.schedule_slot_blocks;
CREATE POLICY "schedule_slot_blocks_staff_select" ON public.schedule_slot_blocks FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.is_staff(auth.uid()));

-- Bloquea (o desbloquea) un bloque puntual. Al bloquear, si alguien ya había
-- reservado esa clase, se cancela su reserva y se le regresa su crédito.
-- Devuelve cuántas reservas se cancelaron.
CREATE OR REPLACE FUNCTION public.set_schedule_slot_block(
  _module_key text,
  _day date,
  _start_time text,
  _blocked boolean
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _time time := _start_time::time;
  _class_id uuid;
  _b record;
  _cancelled int := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Solo administración puede bloquear horarios';
  END IF;

  SELECT id INTO _class_id FROM public.classes
  WHERE module_key = _module_key
    AND (starts_at AT TIME ZONE 'America/Monterrey')::date = _day
    AND to_char(starts_at AT TIME ZONE 'America/Monterrey', 'HH24:MI') = to_char(_time, 'HH24:MI')
  LIMIT 1;

  IF _blocked THEN
    INSERT INTO public.schedule_slot_blocks (module_key, day, start_time, created_by)
      VALUES (_module_key, _day, _time, auth.uid())
      ON CONFLICT (module_key, day, start_time) DO NOTHING;

    IF _class_id IS NOT NULL THEN
      FOR _b IN
        SELECT id, user_id, tokens_spent FROM public.bookings
        WHERE class_id = _class_id AND status = 'reservada'
      LOOP
        UPDATE public.bookings SET status = 'cancelada' WHERE id = _b.id;
        IF _b.tokens_spent > 0 THEN
          INSERT INTO public.token_ledger (user_id, delta, reason, created_by)
            VALUES (_b.user_id, _b.tokens_spent, 'Clase cancelada por el estudio', auth.uid());
        END IF;
        _cancelled := _cancelled + 1;
      END LOOP;
      UPDATE public.classes SET active = false WHERE id = _class_id;
    END IF;
  ELSE
    DELETE FROM public.schedule_slot_blocks
      WHERE module_key = _module_key AND day = _day AND start_time = _time;
    IF _class_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.schedule_blackouts WHERE module_key = _module_key AND day = _day
    ) THEN
      UPDATE public.classes SET active = true WHERE id = _class_id;
    END IF;
  END IF;

  RETURN _cancelled;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_schedule_slot_block(text, date, text, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_schedule_slot_block(text, date, text, boolean) TO authenticated;

-- Misma lógica que la versión actual de "Actualizar clases", más: los bloques
-- bloqueados de una semana no se crean ni se reactivan, y se mantienen apagados.
CREATE OR REPLACE FUNCTION public.publish_schedule_range(_module_key text, _from date, _to date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month date := date_trunc('month', _from)::date;
  v_day date;
  v_t record;
  v_touched integer := 0;
  v_class_id uuid;
  v_booked integer;
  v_coach_name text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Solo administración puede actualizar la programación';
  END IF;

  FOR v_day IN SELECT generate_series(_from, _to, interval '1 day')::date LOOP
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.schedule_blackouts b
      WHERE b.module_key = _module_key AND b.day = v_day
    );

    FOR v_t IN
      SELECT * FROM public.schedule_templates
      WHERE module_key = _module_key
        AND month = v_month
        AND active = true
        AND weekday = EXTRACT(ISODOW FROM v_day)::int - 1
    LOOP
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM public.schedule_slot_blocks sb
        WHERE sb.module_key = _module_key AND sb.day = v_day
          AND to_char(sb.start_time, 'HH24:MI') = to_char(v_t.start_time, 'HH24:MI')
      );

      SELECT id INTO v_class_id
      FROM public.classes
      WHERE module_key = _module_key
        AND starts_at::date = v_day
        AND to_char(starts_at AT TIME ZONE 'America/Monterrey', 'HH24:MI') = to_char(v_t.start_time, 'HH24:MI')
      LIMIT 1;

      SELECT full_name INTO v_coach_name FROM public.staff_profiles WHERE id = v_t.coach_id;

      IF v_class_id IS NULL THEN
        INSERT INTO public.classes (module_key, class_type_id, room, instructor, starts_at, duration_min, capacity, tokens_cost, active, coach_id)
        VALUES (
          _module_key,
          NULL,
          v_t.room,
          COALESCE(v_coach_name, 'Por asignar'),
          (v_day::text || ' ' || to_char(v_t.start_time, 'HH24:MI') || ':00')::timestamp AT TIME ZONE 'America/Monterrey',
          v_t.duration_min,
          v_t.capacity,
          1,
          true,
          v_t.coach_id
        );
        v_touched := v_touched + 1;
      ELSE
        SELECT count(*) INTO v_booked FROM public.bookings WHERE class_id = v_class_id AND status = 'reservada';
        UPDATE public.classes
        SET coach_id = v_t.coach_id,
            instructor = COALESCE(v_coach_name, instructor),
            room = v_t.room,
            duration_min = v_t.duration_min,
            capacity = GREATEST(v_t.capacity, v_booked),
            active = true
        WHERE id = v_class_id;
        v_touched := v_touched + 1;
      END IF;
    END LOOP;
  END LOOP;

  UPDATE public.classes c
  SET active = false
  WHERE c.module_key = _module_key
    AND c.starts_at::date BETWEEN _from AND _to
    AND (
      EXISTS (
        SELECT 1 FROM public.schedule_blackouts b
        WHERE b.module_key = _module_key AND b.day = c.starts_at::date
      )
      OR EXISTS (
        SELECT 1 FROM public.schedule_slot_blocks sb
        WHERE sb.module_key = _module_key
          AND sb.day = (c.starts_at AT TIME ZONE 'America/Monterrey')::date
          AND to_char(sb.start_time, 'HH24:MI') = to_char(c.starts_at AT TIME ZONE 'America/Monterrey', 'HH24:MI')
      )
      OR NOT EXISTS (
        SELECT 1 FROM public.schedule_templates t
        WHERE t.module_key = _module_key
          AND t.month = v_month
          AND t.active = true
          AND t.weekday = EXTRACT(ISODOW FROM c.starts_at::date)::int - 1
          AND to_char(t.start_time, 'HH24:MI') = to_char(c.starts_at AT TIME ZONE 'America/Monterrey', 'HH24:MI')
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.bookings b WHERE b.class_id = c.id AND b.status = 'reservada'
    );

  RETURN v_touched;
END;
$$;


-- ---------------------------------------------------------------------------
-- 5) Seguridad: completar una solicitud de membresía solo lo puede hacer el
--    staff. La versión anterior no lo revisaba, y un cliente podía crear su
--    propia solicitud y completarla él mismo (membresía sin pagar).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_membership_request(
  _request_id uuid,
  _staff_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id uuid;
  _plan_id uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.is_staff(auth.uid())) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT user_id, plan_id INTO _user_id, _plan_id
    FROM public.membership_requests WHERE id = _request_id AND status = 'pendiente';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND_OR_ALREADY_HANDLED';
  END IF;

  PERFORM public.fulfill_plan_purchase(
    _user_id,
    _plan_id,
    'membership_request_' || _request_id::text,
    'tarjeta'
  );

  UPDATE public.membership_requests
    SET status = 'inscrito', completed_at = now(), completed_by = _staff_id
    WHERE id = _request_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.complete_membership_request(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.complete_membership_request(uuid, uuid) TO authenticated;

-- Los clientes solo pueden CREAR y VER sus solicitudes; ya no pueden
-- modificarlas (antes la política les daba permiso completo).
DROP POLICY IF EXISTS "membership_requests_self_insert_select" ON public.membership_requests;
DROP POLICY IF EXISTS "membership_requests_self_insert" ON public.membership_requests;
DROP POLICY IF EXISTS "membership_requests_self_select" ON public.membership_requests;
CREATE POLICY "membership_requests_self_insert" ON public.membership_requests
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND status = 'pendiente');
CREATE POLICY "membership_requests_self_select" ON public.membership_requests
  FOR SELECT TO authenticated USING (user_id = auth.uid());
