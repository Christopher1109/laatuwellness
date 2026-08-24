-- ============================================================================
-- TIENDA DEL CLIENTE (Store) — el cliente arma su pedido (merch, Recovery
-- Bar) desde la app y se paga al recogerlo en el estudio (todavía sin
-- Stripe). El pedido entra como "pendiente" y el staff lo va avanzando
-- desde el nuevo panel "Pedidos pendientes".
-- ============================================================================
ALTER TABLE public.pos_sales ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'entregado';
-- Valores usados: 'pendiente' (recién pedido), 'listo' (preparado, avisar
-- al cliente), 'entregado' (ya se le dio y ya se cobró).

CREATE OR REPLACE FUNCTION public.client_place_order(_items jsonb, _note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _sale_id uuid;
  _item jsonb;
  _total int := 0;
  _unit int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  INSERT INTO public.pos_sales (sold_by, user_id, payment_method, status)
    VALUES (_uid, _uid, 'pendiente', 'pendiente')
    RETURNING id INTO _sale_id;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    SELECT price_cents INTO _unit FROM public.products WHERE id = nullif(_item->>'product_id', '')::uuid;
    IF _unit IS NULL THEN
      RAISE EXCEPTION 'PRODUCT_NOT_FOUND';
    END IF;
    INSERT INTO public.pos_sale_items (sale_id, product_id, description, qty, unit_price_cents)
      VALUES (_sale_id, (_item->>'product_id')::uuid, coalesce(_item->>'description', ''), (_item->>'qty')::int, _unit);
    _total := _total + _unit * (_item->>'qty')::int;
    INSERT INTO public.inventory_movements (product_id, delta, reason, created_by)
      VALUES ((_item->>'product_id')::uuid, -((_item->>'qty')::int), 'Pedido de tienda ' || _sale_id, _uid);
    UPDATE public.products SET stock = stock - (_item->>'qty')::int WHERE id = (_item->>'product_id')::uuid;
  END LOOP;

  UPDATE public.pos_sales SET total_cents = _total WHERE id = _sale_id;
  RETURN _sale_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.client_place_order(jsonb, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.client_place_order(jsonb, text) TO authenticated;

-- Cliente puede ver/insertar solo sus propios pedidos (aparte de la lectura
-- de staff/admin que ya existe en "pos_sales_select").
CREATE POLICY "pos_sales_client_select_own" ON public.pos_sales FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Staff/admin puede actualizar el estatus del pedido (avanzarlo).
GRANT UPDATE ON public.pos_sales TO authenticated;
CREATE POLICY "pos_sales_staff_update" ON public.pos_sales FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.is_staff(auth.uid()))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.is_staff(auth.uid()));

CREATE POLICY "pos_items_client_select_own" ON public.pos_sale_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pos_sales s WHERE s.id = sale_id AND s.user_id = auth.uid()));
