-- Punto de venta: pago mixto (una parte en la terminal Clip y el resto en
-- efectivo o transferencia) y cobros de monto libre (sin producto).
--
-- * pos_terminal_payments.amount_cents sigue siendo lo que se cobra en la
--   terminal; other_cents / other_method es lo que se recibió aparte.
-- * La venta y cada paquete quedan con payment_method = 'mixto' y en
--   payment_split cuánto se pagó con cada método, para que los reportes cuadren.
-- * Los cobros de monto libre se guardan como renglones sin product_id.

ALTER TABLE public.pos_terminal_payments
  ADD COLUMN IF NOT EXISTS other_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_method text;

ALTER TABLE public.pos_terminal_payments
  DROP CONSTRAINT IF EXISTS pos_terminal_payments_other_chk;
ALTER TABLE public.pos_terminal_payments
  ADD CONSTRAINT pos_terminal_payments_other_chk CHECK (
    other_cents >= 0
    AND (other_cents = 0 OR other_method IN ('efectivo', 'transferencia'))
  );

ALTER TABLE public.pos_sales ADD COLUMN IF NOT EXISTS payment_split jsonb;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS payment_split jsonb;

CREATE OR REPLACE FUNCTION public.pos_finalize_terminal_payment(_payment_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _p public.pos_terminal_payments;
  _sale_id uuid;
  _item jsonb;
  _qty int;
  _unit int;
  _total int := 0;
  _n int;
  _mixed boolean;
  _method text;
  _grand int;
  _card_left int;
  _count int;
  _i int := 0;
  _card int;
  _r record;
BEGIN
  SELECT * INTO _p FROM public.pos_terminal_payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TERMINAL_PAYMENT_NOT_FOUND'; END IF;
  IF _p.status = 'completed' THEN RETURN _p.sale_id; END IF;

  _mixed := coalesce(_p.other_cents, 0) > 0;
  _method := CASE WHEN _mixed THEN 'mixto' ELSE 'tarjeta' END;

  IF jsonb_array_length(_p.items) > 0 THEN
    INSERT INTO public.pos_sales (sold_by, user_id, payment_method, brand, status, external_ref)
      VALUES (_p.sold_by, _p.user_id, _method, _p.brand, CASE WHEN _p.deliver_now THEN 'entregado' ELSE 'pendiente' END, 'pinpad_' || coalesce(_p.pinpad_request_id, _p.id::text))
      RETURNING id INTO _sale_id;

    FOR _item IN SELECT * FROM jsonb_array_elements(_p.items) LOOP
      _qty := (_item->>'qty')::int;
      _unit := (_item->>'unit_price_cents')::int;
      INSERT INTO public.pos_sale_items (sale_id, product_id, description, qty, unit_price_cents)
        VALUES (_sale_id, nullif(_item->>'product_id', '')::uuid, coalesce(_item->>'description', ''), _qty, _unit);
      _total := _total + _unit * _qty;
      IF coalesce(_item->>'product_id', '') <> '' THEN
        INSERT INTO public.inventory_movements (product_id, delta, reason, created_by)
          VALUES ((_item->>'product_id')::uuid, -_qty, 'Venta POS terminal Clip ' || _sale_id, _p.sold_by);
        UPDATE public.products SET stock = stock - _qty WHERE id = (_item->>'product_id')::uuid;
      END IF;
    END LOOP;

    UPDATE public.pos_sales SET total_cents = _total WHERE id = _sale_id;
  END IF;

  IF jsonb_array_length(_p.plans) > 0 THEN
    IF _p.user_id IS NULL THEN RAISE EXCEPTION 'PLAN_SALE_REQUIRES_CLIENT'; END IF;
    FOR _item IN SELECT * FROM jsonb_array_elements(_p.plans) LOOP
      FOR _n IN 1..greatest((_item->>'qty')::int, 1) LOOP
        PERFORM public.fulfill_plan_purchase(
          _p.user_id,
          (_item->>'plan_id')::uuid,
          'pinpad_' || _p.id::text || '_' || (_item->>'plan_id') || '_' || _n::text,
          _method
        );
      END LOOP;
    END LOOP;
  END IF;

  -- Pago mixto: se reparte lo cobrado en terminal entre la venta y cada
  -- paquete en proporción a su precio; el último renglón se lleva el residuo
  -- para que la suma cuadre al centavo.
  IF _mixed THEN
    _grand := _p.amount_cents + _p.other_cents;
    _card_left := _p.amount_cents;
    SELECT count(*) INTO _count FROM (
      SELECT _sale_id AS id WHERE _sale_id IS NOT NULL
      UNION ALL
      SELECT t.id FROM public.transactions t
       WHERE t.external_ref LIKE 'pinpad\_' || _p.id::text || '\_%'
    ) x;
    FOR _r IN
      SELECT 'sale' AS kind, _sale_id AS id, _total AS amt, '0' AS ord WHERE _sale_id IS NOT NULL
      UNION ALL
      SELECT 'tx', t.id, t.amount_cents, t.external_ref FROM public.transactions t
       WHERE t.external_ref LIKE 'pinpad\_' || _p.id::text || '\_%'
      ORDER BY 4
    LOOP
      _i := _i + 1;
      IF _i = _count THEN
        _card := _card_left;
      ELSE
        _card := round(_r.amt::numeric * _p.amount_cents / greatest(_grand, 1))::int;
      END IF;
      _card := greatest(least(_card, _card_left, _r.amt), 0);
      _card_left := _card_left - _card;
      IF _r.kind = 'sale' THEN
        UPDATE public.pos_sales
           SET payment_split = jsonb_build_object('tarjeta', _card, _p.other_method, _r.amt - _card)
         WHERE id = _r.id;
      ELSE
        UPDATE public.transactions
           SET payment_method = 'mixto',
               payment_split = jsonb_build_object('tarjeta', _card, _p.other_method, _r.amt - _card)
         WHERE id = _r.id;
      END IF;
    END LOOP;
  END IF;

  UPDATE public.pos_terminal_payments
    SET sale_id = _sale_id, status = 'completed', updated_at = now()
    WHERE id = _payment_id;
  RETURN _sale_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.pos_recent_sales(_limit integer DEFAULT 40)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN NOT (public.has_role(auth.uid(), 'admin') OR public.is_staff(auth.uid())) THEN '[]'::jsonb
    ELSE coalesce((
      SELECT jsonb_agg(r ORDER BY r->>'created_at' DESC)
      FROM (
        SELECT r FROM (
          SELECT jsonb_build_object(
            'kind', 'terminal', 'id', tp.id, 'created_at', tp.created_at,
            'method', CASE WHEN coalesce(tp.other_cents, 0) > 0 THEN 'mixto' ELSE 'tarjeta' END,
            'brand', tp.brand, 'amount_cents', tp.amount_cents + coalesce(tp.other_cents, 0),
            'card_cents', tp.amount_cents,
            'other_cents', coalesce(tp.other_cents, 0),
            'other_method', tp.other_method,
            'card_last4', tp.card_last4,
            'refunded', tp.refunded_at IS NOT NULL, 'refund_amount_cents', tp.refund_amount_cents,
            'description', trim(both ', ' FROM
               coalesce((SELECT string_agg((x->>'qty') || ' × ' || (x->>'description'), ', ') FROM jsonb_array_elements(tp.items) x), '')
               || ', ' ||
               coalesce((SELECT string_agg((x->>'qty') || ' × ' || (x->>'name'), ', ') FROM jsonb_array_elements(tp.plans) x), '')),
            'client', (SELECT coalesce(nullif(full_name, ''), email) FROM public.profiles WHERE id = tp.user_id)
          ) r, tp.created_at
          FROM public.pos_terminal_payments tp WHERE tp.status = 'completed'
          UNION ALL
          SELECT jsonb_build_object(
            'kind', 'sale', 'id', s.id, 'created_at', s.created_at,
            'method', s.payment_method, 'brand', coalesce(s.brand, 'laatu'), 'amount_cents', s.total_cents,
            'card_cents', NULL, 'other_cents', NULL, 'other_method', NULL,
            'card_last4', NULL,
            'refunded', s.status = 'reembolsado', 'refund_amount_cents', CASE WHEN s.status = 'reembolsado' THEN s.total_cents END,
            'description', (SELECT string_agg(i.qty || ' × ' || i.description, ', ') FROM public.pos_sale_items i WHERE i.sale_id = s.id),
            'client', (SELECT coalesce(nullif(full_name, ''), email) FROM public.profiles WHERE id = s.user_id)
          ), s.created_at
          FROM public.pos_sales s
          WHERE s.payment_method IN ('efectivo', 'transferencia') AND coalesce(s.external_ref, '') NOT LIKE 'pinpad\_%'
          UNION ALL
          SELECT jsonb_build_object(
            'kind', 'transaction', 'id', t.id, 'created_at', t.created_at,
            'method', t.payment_method, 'brand', 'laatu', 'amount_cents', t.amount_cents,
            'card_cents', NULL, 'other_cents', NULL, 'other_method', NULL,
            'card_last4', NULL,
            'refunded', t.status <> 'completed', 'refund_amount_cents', t.refund_amount_cents,
            'description', '1 × ' || coalesce(p.name, 'Paquete'),
            'client', (SELECT coalesce(nullif(full_name, ''), email) FROM public.profiles WHERE id = t.user_id)
          ), t.created_at
          FROM public.transactions t LEFT JOIN public.token_plans p ON p.id = t.plan_id
          WHERE coalesce(t.external_ref, '') LIKE 'pos\_cash\_%'
        ) u
        ORDER BY u.created_at DESC
        LIMIT greatest(least(_limit, 200), 1)
      ) q(r)
    ), '[]'::jsonb)
  END
$function$;

CREATE OR REPLACE FUNCTION public.pos_refund_preview(_kind text, _id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _user uuid;
  _already boolean := false;
  _method text;
  _product_cents int := 0;
  _plan_cents int := 0;
  _plan_refund_cents int := 0;
  _tokens int := 0;
  _removable int := 0;
  _balance int := 0;
  _total int := 0;
  _refund int := 0;
  _card_refund int := 0;
  _other_method text;
  _products jsonb := '[]'::jsonb;
  _plans jsonb := '[]'::jsonb;
  _tp public.pos_terminal_payments;
  _s public.pos_sales;
  _t public.transactions;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  IF _kind = 'terminal' THEN
    SELECT * INTO _tp FROM public.pos_terminal_payments WHERE id = _id;
    IF NOT FOUND OR _tp.status <> 'completed' THEN RAISE EXCEPTION 'SALE_NOT_FOUND'; END IF;
    _user := _tp.user_id; _already := _tp.refunded_at IS NOT NULL;
    _method := CASE WHEN coalesce(_tp.other_cents, 0) > 0 THEN 'mixto' ELSE 'tarjeta' END;
    _other_method := _tp.other_method;
    _total := _tp.amount_cents + coalesce(_tp.other_cents, 0);
    SELECT coalesce(sum((x->>'unit_price_cents')::int * (x->>'qty')::int), 0),
           coalesce(jsonb_agg(jsonb_build_object('name', x->>'description', 'qty', (x->>'qty')::int)), '[]'::jsonb)
      INTO _product_cents, _products
      FROM jsonb_array_elements(_tp.items) x;
    SELECT coalesce(sum(t.amount_cents), 0), coalesce(sum(t.tokens), 0),
           coalesce(jsonb_agg(jsonb_build_object('name', p.name, 'tokens', t.tokens, 'price_cents', t.amount_cents)), '[]'::jsonb)
      INTO _plan_cents, _tokens, _plans
      FROM public.transactions t JOIN public.token_plans p ON p.id = t.plan_id
      WHERE t.external_ref LIKE 'pinpad\_' || _tp.id::text || '\_%' AND t.status = 'completed';

  ELSIF _kind = 'sale' THEN
    SELECT * INTO _s FROM public.pos_sales WHERE id = _id;
    IF NOT FOUND THEN RAISE EXCEPTION 'SALE_NOT_FOUND'; END IF;
    IF coalesce(_s.external_ref, '') LIKE 'pinpad\_%' THEN RAISE EXCEPTION 'USE_TERMINAL_REFUND'; END IF;
    IF _s.payment_method NOT IN ('efectivo', 'transferencia') THEN RAISE EXCEPTION 'ONLY_CASH_SALES'; END IF;
    _user := _s.user_id; _already := _s.status = 'reembolsado'; _method := _s.payment_method;
    _product_cents := _s.total_cents; _total := _s.total_cents;
    SELECT coalesce(jsonb_agg(jsonb_build_object('name', i.description, 'qty', i.qty)), '[]'::jsonb)
      INTO _products FROM public.pos_sale_items i WHERE i.sale_id = _s.id;

  ELSIF _kind = 'transaction' THEN
    SELECT * INTO _t FROM public.transactions WHERE id = _id;
    IF NOT FOUND THEN RAISE EXCEPTION 'SALE_NOT_FOUND'; END IF;
    IF coalesce(_t.external_ref, '') NOT LIKE 'pos\_cash\_%' THEN RAISE EXCEPTION 'ONLY_CASH_SALES'; END IF;
    _user := _t.user_id; _already := _t.status <> 'completed'; _method := _t.payment_method;
    _plan_cents := _t.amount_cents; _tokens := _t.tokens; _total := _t.amount_cents;
    SELECT jsonb_build_array(jsonb_build_object('name', p.name, 'tokens', _t.tokens, 'price_cents', _t.amount_cents))
      INTO _plans FROM public.token_plans p WHERE p.id = _t.plan_id;
  ELSE
    RAISE EXCEPTION 'INVALID_KIND';
  END IF;

  IF _tokens > 0 AND _user IS NOT NULL THEN
    _balance := greatest(public.token_balance(_user), 0);
    _removable := least(_tokens, _balance);
    _plan_refund_cents := CASE WHEN _tokens = 0 THEN 0
                               ELSE round(_plan_cents::numeric * _removable / _tokens)::int END;
  END IF;

  _refund := _product_cents + _plan_refund_cents;
  -- En pago mixto se devuelve a la tarjeta la parte proporcional a lo que se
  -- cobró en terminal; el resto se entrega en efectivo / transferencia.
  IF _kind = 'terminal' THEN
    _card_refund := CASE WHEN _total > 0
                         THEN least(round(_refund::numeric * _tp.amount_cents / _total)::int, _tp.amount_cents)
                         ELSE 0 END;
  END IF;

  RETURN jsonb_build_object(
    'kind', _kind,
    'id', _id,
    'method', _method,
    'other_method', _other_method,
    'already_refunded', _already,
    'total_cents', _total,
    'product_cents', _product_cents,
    'products', _products,
    'plans', _plans,
    'tokens_granted', _tokens,
    'tokens_removable', _removable,
    'tokens_used', _tokens - _removable,
    'refund_cents', _refund,
    'card_refund_cents', _card_refund,
    'other_refund_cents', CASE WHEN _kind = 'terminal' THEN _refund - _card_refund ELSE 0 END,
    'client', (SELECT jsonb_build_object('name', full_name, 'email', email) FROM public.profiles WHERE id = _user)
  );
END;
$function$;
