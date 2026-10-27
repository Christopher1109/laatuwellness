-- Merch: al venderlo en el mostrador se elige si se entrega en ese momento.
-- Si no, la venta queda "pendiente" y aparece en Pedidos pendientes con el
-- cliente que lo compró (igual que los pedidos en línea).

ALTER TABLE public.pos_terminal_payments ADD COLUMN IF NOT EXISTS deliver_now boolean NOT NULL DEFAULT true;

DO $migration$
DECLARE v_def text;
BEGIN
  v_def := pg_get_functiondef('public.pos_finalize_terminal_payment(uuid)'::regprocedure);
  v_def := replace(v_def,
    'VALUES (_p.sold_by, _p.user_id, ''tarjeta'', _p.brand, ''entregado'', ''pinpad_'' || coalesce(_p.pinpad_request_id, _p.id::text))',
    'VALUES (_p.sold_by, _p.user_id, ''tarjeta'', _p.brand, CASE WHEN _p.deliver_now THEN ''entregado'' ELSE ''pendiente'' END, ''pinpad_'' || coalesce(_p.pinpad_request_id, _p.id::text))');
  IF position('_p.deliver_now' in v_def) = 0 THEN
    RAISE EXCEPTION 'pos_finalize_terminal_payment no tiene el formato esperado';
  END IF;
  EXECUTE v_def;
END $migration$;

DROP FUNCTION IF EXISTS public.pos_checkout(uuid, text, jsonb, text);
CREATE OR REPLACE FUNCTION public.pos_checkout(_user_id uuid, _payment_method text, _items jsonb, _brand text DEFAULT 'laatu'::text, _deliver_now boolean DEFAULT true)
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
  IF NOT coalesce(_deliver_now, true) AND _user_id IS NULL THEN
    RAISE EXCEPTION 'MERCH_REQUIRES_CLIENT';
  END IF;

  INSERT INTO public.pos_sales (sold_by, user_id, payment_method, brand, status)
    VALUES (auth.uid(), _user_id, _method, coalesce(_brand,'laatu'),
            CASE WHEN coalesce(_deliver_now, true) THEN 'entregado' ELSE 'pendiente' END)
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
