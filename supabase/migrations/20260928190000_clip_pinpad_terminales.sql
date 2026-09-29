-- ============================================================================
-- Cobro en terminales Clip desde el punto de venta (API de PinPad).
--
-- Flujo: el staff le da "Cobrar con tarjeta" en el POS -> el servidor crea
-- una intención de pago en la terminal de la marca correcta (Läätu o Goodes,
-- cada una ligada a su propia cuenta Clip) -> la terminal se despierta sola
-- con el monto -> Clip avisa por webhook -> el servidor confirma el estado
-- real con Clip y SOLO entonces registra la venta y descuenta inventario.
--
-- pos_terminals          : qué número de serie usa cada marca (editable
--                          desde el admin, no es dato secreto).
-- pos_terminal_payments  : cada intento de cobro en terminal, con su estado.
--                          La venta (pos_sales) se crea hasta que Clip
--                          confirma el pago, nunca antes.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.pos_terminals (
  brand text PRIMARY KEY CHECK (brand IN ('laatu', 'goodes')),
  label text NOT NULL,
  serial_number text,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, UPDATE ON public.pos_terminals TO authenticated;
GRANT ALL ON public.pos_terminals TO service_role;
ALTER TABLE public.pos_terminals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pos_terminals_select" ON public.pos_terminals;
CREATE POLICY "pos_terminals_select" ON public.pos_terminals FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "pos_terminals_admin_update" ON public.pos_terminals;
CREATE POLICY "pos_terminals_admin_update" ON public.pos_terminals FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.pos_terminals (brand, label, serial_number)
VALUES
  ('laatu', 'Terminal Läätu (Clip Total 3)', 'AA61B532642902272'),
  ('goodes', 'Terminal Goodes', NULL)
ON CONFLICT (brand) DO NOTHING;


CREATE TABLE IF NOT EXISTS public.pos_terminal_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand text NOT NULL CHECK (brand IN ('laatu', 'goodes')),
  serial_number text NOT NULL,
  sold_by uuid,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Productos: [{"product_id": "...", "qty": 2, "unit_price_cents": 15000, "description": "..."}]
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Paquetes/clases: [{"plan_id": "...", "qty": 1, "price_cents": 45000, "name": "..."}]
  -- Siempre llevan cliente (user_id), a quien se le acreditan al confirmar el pago.
  plans jsonb NOT NULL DEFAULT '[]'::jsonb,
  amount_cents int NOT NULL CHECK (amount_cents > 0),
  -- creating | pending | completed | failed | canceled
  status text NOT NULL DEFAULT 'creating',
  pinpad_request_id text UNIQUE,
  clip_status text,
  amount_paid_cents int,
  card_last4 text,
  card_brand text,
  sale_id uuid REFERENCES public.pos_sales(id) ON DELETE SET NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pos_terminal_payments_created_idx
  ON public.pos_terminal_payments (created_at DESC);

GRANT SELECT ON public.pos_terminal_payments TO authenticated;
GRANT ALL ON public.pos_terminal_payments TO service_role;
ALTER TABLE public.pos_terminal_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pos_terminal_payments_select" ON public.pos_terminal_payments;
CREATE POLICY "pos_terminal_payments_select" ON public.pos_terminal_payments FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.is_staff(auth.uid()));


-- Registra la venta de un cobro en terminal ya confirmado por Clip:
--   * productos -> una venta en pos_sales + descuento de inventario
--   * paquetes  -> se acreditan las clases a la cuenta del cliente
--                  (mismo registro que una compra en línea: transactions + token_ledger)
-- Idempotente: si Clip manda el webhook dos veces, o el POS y el webhook
-- llegan al mismo tiempo, todo se registra una sola vez (FOR UPDATE +
-- revisión de status; los paquetes además usan un external_ref único).
CREATE OR REPLACE FUNCTION public.pos_finalize_terminal_payment(_payment_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _p public.pos_terminal_payments;
  _sale_id uuid;
  _item jsonb;
  _qty int;
  _unit int;
  _total int := 0;
  _n int;
BEGIN
  SELECT * INTO _p FROM public.pos_terminal_payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TERMINAL_PAYMENT_NOT_FOUND'; END IF;
  IF _p.status = 'completed' THEN RETURN _p.sale_id; END IF;

  IF jsonb_array_length(_p.items) > 0 THEN
    INSERT INTO public.pos_sales (sold_by, user_id, payment_method, brand, status, external_ref)
      VALUES (_p.sold_by, _p.user_id, 'tarjeta', _p.brand, 'entregado', 'pinpad_' || coalesce(_p.pinpad_request_id, _p.id::text))
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
          'tarjeta'
        );
      END LOOP;
    END LOOP;
  END IF;

  UPDATE public.pos_terminal_payments
    SET sale_id = _sale_id, status = 'completed', updated_at = now()
    WHERE id = _payment_id;
  RETURN _sale_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pos_finalize_terminal_payment(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_finalize_terminal_payment(uuid) TO service_role;


-- Venta de paquetes en efectivo desde el POS: acredita las clases al cliente
-- en el momento (el staff ya recibió el dinero). Usa la misma función que
-- las compras en línea para que se vea igual en la cuenta del cliente.
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
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.is_staff(auth.uid())) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF _user_id IS NULL THEN RAISE EXCEPTION 'PLAN_SALE_REQUIRES_CLIENT'; END IF;

  FOR _item IN SELECT * FROM jsonb_array_elements(_plans) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.token_plans WHERE id = (_item->>'plan_id')::uuid AND active) THEN
      RAISE EXCEPTION 'PLAN_NOT_FOUND';
    END IF;
    FOR _n IN 1..greatest((_item->>'qty')::int, 1) LOOP
      PERFORM public.fulfill_plan_purchase(
        _user_id,
        (_item->>'plan_id')::uuid,
        'pos_cash_' || _batch || '_' || (_item->>'plan_id') || '_' || _n::text,
        'efectivo'
      );
      _count := _count + 1;
    END LOOP;
  END LOOP;
  RETURN _count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pos_sell_plans_cash(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.pos_sell_plans_cash(uuid, jsonb) TO authenticated;
