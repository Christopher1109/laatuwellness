-- ============================================================================
-- Separación Läätu / Goodes en el punto de venta. Goodes solo se vende en
-- persona (nunca en la página web) y su dinero va a una cuenta de Clip
-- distinta — cada terminal física está ligada a una sola cuenta, así que
-- el staff necesita saber en qué terminal cobrar cada venta.
--
-- 'brand' es independiente de 'category': category dice QUÉ TIPO de
-- producto es (merch/consumibles/bar), brand dice DE QUIÉN es (laatu o
-- goodes). Un producto de Goodes puede ser categoría 'merch' sin que por
-- eso aparezca en la tienda pública — la tienda pública ahora filtra
-- también por brand = 'laatu' explícitamente.
-- ============================================================================

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS brand text NOT NULL DEFAULT 'laatu';
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_brand_check;
ALTER TABLE public.products ADD CONSTRAINT products_brand_check CHECK (brand IN ('laatu', 'goodes'));

ALTER TABLE public.pos_sales ADD COLUMN IF NOT EXISTS brand text;

-- Se reemplaza por completo (firma distinta = función distinta en Postgres,
-- si no se borra primero quedarían las dos versiones a la vez).
DROP FUNCTION IF EXISTS public.pos_checkout(uuid, text, jsonb);

CREATE OR REPLACE FUNCTION public.pos_checkout(
  _user_id uuid,
  _payment_method text,
  _items jsonb,
  _brand text DEFAULT 'laatu'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _sale_id uuid;
  _item jsonb;
  _total int := 0;
  _unit int;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.is_staff(auth.uid())) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  INSERT INTO public.pos_sales (sold_by, user_id, payment_method, brand)
    VALUES (auth.uid(), _user_id, coalesce(_payment_method,'efectivo'), coalesce(_brand,'laatu'))
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
$$;
GRANT EXECUTE ON FUNCTION public.pos_checkout(uuid, text, jsonb, text) TO authenticated;
