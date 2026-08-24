ALTER TABLE public.pos_sales ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'entregado';

CREATE OR REPLACE FUNCTION public.client_place_order(_items jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _sale_id uuid;
  _total int := 0;
  _item jsonb;
  _p public.products%ROWTYPE;
  _qty int;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  INSERT INTO public.pos_sales (user_id, sold_by, total_cents, payment_method, status)
  VALUES (_uid, NULL, 0, 'en_estudio', 'pendiente')
  RETURNING id INTO _sale_id;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _qty := GREATEST(COALESCE((_item->>'qty')::int, 0), 0);
    CONTINUE WHEN _qty = 0;
    SELECT * INTO _p FROM public.products WHERE id = (_item->>'product_id')::uuid AND active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Producto no disponible';
    END IF;
    INSERT INTO public.pos_sale_items (sale_id, product_id, description, qty, unit_price_cents)
    VALUES (_sale_id, _p.id, _p.name, _qty, _p.price_cents);
    _total := _total + _p.price_cents * _qty;
  END LOOP;

  UPDATE public.pos_sales SET total_cents = _total WHERE id = _sale_id;
  RETURN _sale_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.client_place_order(jsonb) TO authenticated;