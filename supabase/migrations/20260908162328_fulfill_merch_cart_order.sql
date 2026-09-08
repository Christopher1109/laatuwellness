-- ============================================================================
-- Version de fulfill_merch_order para carritos con VARIOS productos (la
-- pestaña Tienda de /app deja agregar más de un producto). Crea UNA venta
-- con varios renglones, en vez de una venta por producto.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fulfill_merch_cart_order(
  _user_id uuid,
  _items jsonb, -- [{"product_id": "...", "qty": 2}, ...]
  _external_ref text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _sale_id uuid;
  _item jsonb;
  _unit int;
  _name text;
  _qty int;
  _total int := 0;
  _code text;
BEGIN
  SELECT id INTO _sale_id FROM public.pos_sales WHERE external_ref = _external_ref;
  IF FOUND THEN RETURN _sale_id; END IF;

  _code := 'LT-' || lpad(nextval('public.store_order_code_seq')::text, 4, '0');

  INSERT INTO public.pos_sales (sold_by, user_id, payment_method, status, total_cents, order_code, external_ref)
    VALUES (_user_id, _user_id, 'tarjeta', 'pendiente', 0, _code, _external_ref)
    RETURNING id INTO _sale_id;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    SELECT price_cents, name INTO _unit, _name
      FROM public.products WHERE id = (_item->>'product_id')::uuid;
    IF _unit IS NULL THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;
    _qty := (_item->>'qty')::int;

    INSERT INTO public.pos_sale_items (sale_id, product_id, description, qty, unit_price_cents)
      VALUES (_sale_id, (_item->>'product_id')::uuid, _name, _qty, _unit);

    INSERT INTO public.inventory_movements (product_id, delta, reason, created_by)
      VALUES ((_item->>'product_id')::uuid, -_qty, 'Pedido en línea ' || _code, _user_id);
    UPDATE public.products SET stock = stock - _qty WHERE id = (_item->>'product_id')::uuid;

    _total := _total + _unit * _qty;
  END LOOP;

  UPDATE public.pos_sales SET total_cents = _total WHERE id = _sale_id;
  RETURN _sale_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fulfill_merch_cart_order(uuid, jsonb, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_merch_cart_order(uuid, jsonb, text) TO service_role;
