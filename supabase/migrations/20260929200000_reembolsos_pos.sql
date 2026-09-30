-- ============================================================================
-- Reembolsos desde el admin (nunca directo en Clip), para que el dinero y el
-- sistema queden cuadrados en un solo paso:
--   * cobro en terminal Clip  -> el servidor pide el reembolso a Clip y luego
--                                 llama pos_apply_refund('terminal', ...)
--   * venta de productos en efectivo -> pos_apply_refund('sale', ...)
--   * paquete vendido en efectivo    -> pos_apply_refund('transaction', ...)
--
-- Al reembolsar:
--   - productos: la venta queda 'reembolsado' y el producto regresa al inventario
--   - paquetes:  la compra queda 'refunded' y se le quitan los créditos al
--                cliente. Si ya usó algunos, solo se quitan (y se devuelven en
--                dinero) los que le quedan, proporcional al precio.
--   - Newcomer:  al quedar 'refunded' ya no cuenta como compra, así que el
--                cliente puede volver a comprarlo.
-- Solo administradores.
-- ============================================================================

ALTER TABLE public.pos_terminal_payments ADD COLUMN IF NOT EXISTS refunded_at timestamptz;
ALTER TABLE public.pos_terminal_payments ADD COLUMN IF NOT EXISTS refund_amount_cents int;
ALTER TABLE public.pos_terminal_payments ADD COLUMN IF NOT EXISTS clip_refund_id text;
ALTER TABLE public.pos_terminal_payments ADD COLUMN IF NOT EXISTS refund_reason text;
ALTER TABLE public.pos_terminal_payments ADD COLUMN IF NOT EXISTS refunded_by uuid;

ALTER TABLE public.pos_sales ADD COLUMN IF NOT EXISTS refunded_at timestamptz;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS refunded_at timestamptz;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS refund_amount_cents int;


-- Cálculo de un reembolso SIN aplicarlo (para mostrarlo antes de confirmar).
CREATE OR REPLACE FUNCTION public.pos_refund_preview(_kind text, _id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
    _user := _tp.user_id; _already := _tp.refunded_at IS NOT NULL; _method := 'tarjeta';
    _total := _tp.amount_cents;
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
    IF _s.payment_method <> 'efectivo' THEN RAISE EXCEPTION 'ONLY_CASH_SALES'; END IF;
    _user := _s.user_id; _already := _s.status = 'reembolsado'; _method := 'efectivo';
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

  RETURN jsonb_build_object(
    'kind', _kind,
    'id', _id,
    'method', _method,
    'already_refunded', _already,
    'total_cents', _total,
    'product_cents', _product_cents,
    'products', _products,
    'plans', _plans,
    'tokens_granted', _tokens,
    'tokens_removable', _removable,
    'tokens_used', _tokens - _removable,
    'refund_cents', _product_cents + _plan_refund_cents,
    'client', (SELECT jsonb_build_object('name', full_name, 'email', email) FROM public.profiles WHERE id = _user)
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.pos_refund_preview(text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.pos_refund_preview(text, uuid) TO authenticated, service_role;


-- Aplica el reembolso en el sistema. Para 'terminal' solo lo puede llamar el
-- servidor, después de que Clip confirmó que devolvió el dinero.
CREATE OR REPLACE FUNCTION public.pos_apply_refund(
  _kind text,
  _id uuid,
  _reason text,
  _clip_refund_id text DEFAULT NULL,
  _by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _preview jsonb;
  _by_user uuid := coalesce(auth.uid(), _by);
  _sale_id uuid;
  _user uuid;
  _item record;
  _t record;
  _to_remove int;
  _tag text := 'Reembolso' || CASE WHEN coalesce(_reason, '') <> '' THEN ': ' || _reason ELSE '' END;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    IF _kind = 'terminal' THEN RAISE EXCEPTION 'USE_TERMINAL_REFUND'; END IF;
  END IF;

  -- Primero se bloquea el registro (evita reembolsar dos veces a la vez).
  IF _kind = 'terminal' THEN
    SELECT sale_id, user_id INTO _sale_id, _user FROM public.pos_terminal_payments WHERE id = _id FOR UPDATE;
  ELSIF _kind = 'sale' THEN
    _sale_id := _id;
    SELECT user_id INTO _user FROM public.pos_sales WHERE id = _id FOR UPDATE;
  ELSE
    SELECT user_id INTO _user FROM public.transactions WHERE id = _id FOR UPDATE;
  END IF;

  _preview := public.pos_refund_preview(_kind, _id);
  IF (_preview->>'already_refunded')::boolean THEN RAISE EXCEPTION 'ALREADY_REFUNDED'; END IF;
  IF (_preview->>'refund_cents')::int <= 0 AND (_preview->>'total_cents')::int > 0 THEN
    RAISE EXCEPTION 'NOTHING_TO_REFUND';
  END IF;
  _to_remove := (_preview->>'tokens_removable')::int;

  -- Productos -> regresan al inventario

  IF _sale_id IS NOT NULL THEN
    FOR _item IN SELECT product_id, qty FROM public.pos_sale_items WHERE sale_id = _sale_id AND product_id IS NOT NULL LOOP
      INSERT INTO public.inventory_movements (product_id, delta, reason, created_by)
        VALUES (_item.product_id, _item.qty, 'Reembolso venta ' || _sale_id, _by_user);
      UPDATE public.products SET stock = stock + _item.qty WHERE id = _item.product_id;
    END LOOP;
    UPDATE public.pos_sales SET status = 'reembolsado', refunded_at = now() WHERE id = _sale_id;
  END IF;

  -- Paquetes -> se quitan los créditos que queden y la compra deja de contar
  FOR _t IN
    SELECT t.id, t.tokens, t.amount_cents FROM public.transactions t
    WHERE t.status = 'completed' AND (
      (_kind = 'terminal' AND t.external_ref LIKE 'pinpad\_' || _id::text || '\_%')
      OR (_kind = 'transaction' AND t.id = _id)
    )
    FOR UPDATE
  LOOP
    UPDATE public.transactions SET status = 'refunded', refunded_at = now() WHERE id = _t.id;
  END LOOP;
  IF _to_remove > 0 AND _user IS NOT NULL THEN
    INSERT INTO public.token_ledger (user_id, delta, reason, created_by)
      VALUES (_user, -_to_remove, _tag, _by_user);
  END IF;

  IF _kind = 'terminal' THEN
    UPDATE public.pos_terminal_payments
      SET refunded_at = now(),
          refund_amount_cents = (_preview->>'refund_cents')::int,
          clip_refund_id = coalesce(_clip_refund_id, clip_refund_id),
          refund_reason = _reason,
          refunded_by = _by_user
      WHERE id = _id;
  ELSIF _kind = 'transaction' THEN
    UPDATE public.transactions SET refund_amount_cents = (_preview->>'refund_cents')::int WHERE id = _id;
  END IF;

  RETURN _preview;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.pos_apply_refund(text, uuid, text, text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.pos_apply_refund(text, uuid, text, text, uuid) TO authenticated, service_role;


-- Lista unificada de ventas del mostrador para la sección "Ventas recientes".
CREATE OR REPLACE FUNCTION public.pos_recent_sales(_limit int DEFAULT 40)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
            'method', 'efectivo', 'brand', coalesce(s.brand, 'laatu'), 'amount_cents', s.total_cents,
            'card_last4', NULL,
            'refunded', s.status = 'reembolsado', 'refund_amount_cents', CASE WHEN s.status = 'reembolsado' THEN s.total_cents END,
            'description', (SELECT string_agg(i.qty || ' × ' || i.description, ', ') FROM public.pos_sale_items i WHERE i.sale_id = s.id),
            'client', (SELECT coalesce(nullif(full_name, ''), email) FROM public.profiles WHERE id = s.user_id)
          ), s.created_at
          FROM public.pos_sales s
          WHERE s.payment_method = 'efectivo' AND coalesce(s.external_ref, '') NOT LIKE 'pinpad\_%'
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
$$;
REVOKE EXECUTE ON FUNCTION public.pos_recent_sales(int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.pos_recent_sales(int) TO authenticated;
