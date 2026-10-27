-- Punto de venta: método de pago "transferencia". Funciona igual que el
-- efectivo (se registra al confirmar que se recibió el pago y se acreditan los
-- paquetes al cliente), pero queda registrado como transferencia en ventas,
-- reportes y reembolsos.

DROP FUNCTION IF EXISTS public.pos_sell_plans_cash(uuid, jsonb);
CREATE OR REPLACE FUNCTION public.pos_sell_plans_cash(_user_id uuid, _plans jsonb, _payment_method text DEFAULT 'efectivo')
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _item jsonb;
  _n int;
  _count int := 0;
  _batch text := gen_random_uuid()::text;
  _reason text;
  _price int;
  _method text := coalesce(nullif(_payment_method, ''), 'efectivo');
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.is_staff(auth.uid())) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF _user_id IS NULL THEN RAISE EXCEPTION 'PLAN_SALE_REQUIRES_CLIENT'; END IF;
  IF _method NOT IN ('efectivo', 'transferencia') THEN RAISE EXCEPTION 'INVALID_PAYMENT_METHOD'; END IF;

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
        CASE WHEN _price = 0 THEN 'convenio' ELSE _method END
      );
      _count := _count + 1;
    END LOOP;
  END LOOP;
  RETURN _count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.pos_checkout(_user_id uuid, _payment_method text, _items jsonb, _brand text DEFAULT 'laatu'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _sale_id uuid;
  _item jsonb;
  _total int := 0;
  _unit int;
  _method text := coalesce(nullif(_payment_method, ''), 'efectivo');
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.is_staff(auth.uid())) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF _method = 'transferencia' AND _user_id IS NULL THEN
    RAISE EXCEPTION 'TRANSFER_REQUIRES_CLIENT';
  END IF;

  INSERT INTO public.pos_sales (sold_by, user_id, payment_method, brand)
    VALUES (auth.uid(), _user_id, _method, coalesce(_brand,'laatu'))
    RETURNING id INTO _sale_id;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _unit := (_item->>'unit_price_cents')::int;
    INSERT INTO public.pos_sale_items (sale_id, product_id, description, qty, unit_price_cents)
      VALUES (_sale_id, nullif(_item->>'product_id','')::uuid, coalesce(_item->>'description',''), (_item->>'qty')::int, _unit);
    _total := _total + _unit * (_item->>'qty')::int;
    IF (_item->>'product_id') IS NOT NULL AND (_item->>'product_id') <> '' THEN
      PERFORM public.adjust_stock((_item->>'product_id')::uuid, -((_item->>'qty')::int), 'Venta POS ' || _sale_id);
    END IF;
  END LOOP;

  UPDATE public.pos_sales SET total_cents = _total WHERE id = _sale_id;
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
            'method', 'tarjeta', 'brand', tp.brand, 'amount_cents', tp.amount_cents,
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

-- Reembolsos: las ventas de productos por transferencia también se pueden
-- reembolsar desde Ventas recientes y muestran su método real.
DO $migration$
DECLARE v_def text;
BEGIN
  v_def := pg_get_functiondef('public.pos_refund_preview(text, uuid)'::regprocedure);
  v_def := replace(v_def,
    'IF _s.payment_method <> ''efectivo'' THEN RAISE EXCEPTION ''ONLY_CASH_SALES''; END IF;',
    'IF _s.payment_method NOT IN (''efectivo'', ''transferencia'') THEN RAISE EXCEPTION ''ONLY_CASH_SALES''; END IF;');
  v_def := replace(v_def,
    '_already := _s.status = ''reembolsado''; _method := ''efectivo'';',
    '_already := _s.status = ''reembolsado''; _method := _s.payment_method;');
  EXECUTE v_def;
END $migration$;
