-- ============================================================================
-- Merch pagado en línea: el cliente paga con Stripe desde /merch, y cuando
-- el pago se confirma (webhook), se crea el pedido ya "pagado" en el mismo
-- pos_sales que usa el punto de venta físico — así el panel de "Pedidos
-- pendientes" que ya existe funciona igual para los dos casos.
--
-- Se agrega un order_code corto (ej. LT-0001) para que el cliente lo pueda
-- decir en recepción, y una tabla nueva de waiver de entrega (distinta al
-- waiver de clases) que el staff hace firmar al entregar la mercancía.
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS public.store_order_code_seq;

ALTER TABLE public.pos_sales ADD COLUMN IF NOT EXISTS order_code text;
ALTER TABLE public.pos_sales ADD COLUMN IF NOT EXISTS external_ref text;
CREATE UNIQUE INDEX IF NOT EXISTS pos_sales_order_code_key ON public.pos_sales(order_code) WHERE order_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS pos_sales_external_ref_key ON public.pos_sales(external_ref) WHERE external_ref IS NOT NULL;

-- Pedido pagado en línea con Stripe: crea la venta + renglón + descuenta
-- inventario, igual que client_place_order pero ya con status 'pendiente'
-- de RECOLECCIÓN (no de pago, porque el webhook solo llama esto si Stripe
-- ya confirmó el cobro). Idempotente por external_ref (si el webhook se
-- reintenta, no duplica el pedido).
CREATE OR REPLACE FUNCTION public.fulfill_merch_order(
  _user_id uuid,
  _product_id uuid,
  _qty int,
  _external_ref text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _sale_id uuid;
  _unit int;
  _name text;
  _code text;
BEGIN
  SELECT id INTO _sale_id FROM public.pos_sales WHERE external_ref = _external_ref;
  IF FOUND THEN RETURN _sale_id; END IF;

  SELECT price_cents, name INTO _unit, _name FROM public.products WHERE id = _product_id;
  IF _unit IS NULL THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;

  _code := 'LT-' || lpad(nextval('public.store_order_code_seq')::text, 4, '0');

  INSERT INTO public.pos_sales (sold_by, user_id, payment_method, status, total_cents, order_code, external_ref)
    VALUES (_user_id, _user_id, 'tarjeta', 'pendiente', _unit * _qty, _code, _external_ref)
    RETURNING id INTO _sale_id;

  INSERT INTO public.pos_sale_items (sale_id, product_id, description, qty, unit_price_cents)
    VALUES (_sale_id, _product_id, _name, _qty, _unit);

  INSERT INTO public.inventory_movements (product_id, delta, reason, created_by)
    VALUES (_product_id, -_qty, 'Pedido en línea ' || _code, _user_id);
  UPDATE public.products SET stock = stock - _qty WHERE id = _product_id;

  RETURN _sale_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fulfill_merch_order(uuid, uuid, int, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_merch_order(uuid, uuid, int, text) TO service_role;

-- Waiver específico de "recibí mi pedido", firmado por el cliente en la
-- pantalla del staff al momento de la entrega (no es el mismo waiver de
-- clases).
CREATE TABLE IF NOT EXISTS public.merch_pickup_waivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.pos_sales(id) ON DELETE CASCADE,
  signed_at timestamptz NOT NULL DEFAULT now(),
  signature_data text NOT NULL,
  full_name text NOT NULL DEFAULT '',
  staff_id uuid REFERENCES public.staff_profiles(id)
);
GRANT SELECT, INSERT ON public.merch_pickup_waivers TO authenticated;
GRANT ALL ON public.merch_pickup_waivers TO service_role;
ALTER TABLE public.merch_pickup_waivers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "merch_waiver_staff_all" ON public.merch_pickup_waivers;
CREATE POLICY "merch_waiver_staff_all" ON public.merch_pickup_waivers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.is_staff(auth.uid()))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "merch_waiver_client_select_own" ON public.merch_pickup_waivers;
CREATE POLICY "merch_waiver_client_select_own" ON public.merch_pickup_waivers FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pos_sales s WHERE s.id = sale_id AND s.user_id = auth.uid()));
