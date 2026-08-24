-- 1) Bookings: staff access
CREATE POLICY "bookings_select_staff" ON public.bookings FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "bookings_update_staff" ON public.bookings FOR UPDATE TO authenticated
  USING (public.is_staff(auth.uid()) OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.is_staff(auth.uid()) OR public.has_role(auth.uid(),'admin'));
GRANT UPDATE ON public.bookings TO authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS bookings_class_seat_unique
  ON public.bookings (class_id, seat_number)
  WHERE status = 'reservada' AND seat_number IS NOT NULL;

-- 2) Kardex
CREATE TABLE public.activity_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  category text NOT NULL,
  action text NOT NULL,
  description text NOT NULL DEFAULT '',
  actor_id uuid,
  subject_user_id uuid,
  entity_type text,
  entity_id uuid,
  amount_cents integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
GRANT SELECT ON public.activity_log TO authenticated;
GRANT ALL ON public.activity_log TO service_role;
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "activity_log_select_staff" ON public.activity_log FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) OR public.has_role(auth.uid(),'admin'));

CREATE INDEX activity_log_created_at_idx ON public.activity_log (created_at DESC);
CREATE INDEX activity_log_category_idx ON public.activity_log (category);

CREATE OR REPLACE FUNCTION public.log_activity(
  _category text, _action text, _description text,
  _subject uuid DEFAULT NULL, _entity_type text DEFAULT NULL, _entity_id uuid DEFAULT NULL,
  _amount_cents integer DEFAULT NULL, _metadata jsonb DEFAULT '{}'::jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.activity_log (category, action, description, actor_id, subject_user_id, entity_type, entity_id, amount_cents, metadata)
  VALUES (_category, _action, coalesce(_description,''), auth.uid(), _subject, _entity_type, _entity_id, _amount_cents, coalesce(_metadata,'{}'::jsonb));
END; $$;

CREATE OR REPLACE FUNCTION public.person_label(_user_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(nullif(full_name,''), email, 'Usuario') FROM public.profiles WHERE id = _user_id
$$;

-- transactions (compras de paquetes)
CREATE OR REPLACE FUNCTION public.trg_log_transaction() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.log_activity('compras','compra_paquete',
    coalesce(public.person_label(NEW.user_id),'Usuario') || ' compró ' ||
    coalesce((SELECT name FROM public.token_plans WHERE id = NEW.plan_id),'un paquete') ||
    ' (' || NEW.tokens || ' créditos, ' || NEW.payment_method || ')',
    NEW.user_id,'transaction',NEW.id,NEW.amount_cents,
    jsonb_build_object('tokens',NEW.tokens,'status',NEW.status));
  RETURN NEW;
END; $$;
CREATE TRIGGER log_transaction AFTER INSERT ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.trg_log_transaction();

-- token_ledger (créditos)
CREATE OR REPLACE FUNCTION public.trg_log_token_ledger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.log_activity('tokens', CASE WHEN NEW.delta >= 0 THEN 'creditos_agregados' ELSE 'creditos_usados' END,
    coalesce(public.person_label(NEW.user_id),'Usuario') || ': ' ||
    CASE WHEN NEW.delta >= 0 THEN '+' ELSE '' END || NEW.delta || ' créditos · ' || NEW.reason,
    NEW.user_id,'token_ledger',NEW.id,NULL,jsonb_build_object('delta',NEW.delta,'reason',NEW.reason));
  RETURN NEW;
END; $$;
CREATE TRIGGER log_token_ledger AFTER INSERT ON public.token_ledger
  FOR EACH ROW EXECUTE FUNCTION public.trg_log_token_ledger();

-- bookings (reservas / lugares)
CREATE OR REPLACE FUNCTION public.trg_log_booking() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _cls text; _who text;
BEGIN
  SELECT coalesce(module_key,'clase') || ' ' || to_char(starts_at,'DD/MM HH24:MI') INTO _cls
    FROM public.classes WHERE id = NEW.class_id;
  _who := coalesce(public.person_label(NEW.user_id),'Usuario');
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_activity('reservas',
      CASE WHEN NEW.status = 'lista_espera' THEN 'lista_espera' ELSE 'reserva' END,
      _who || ' · ' || NEW.status || ' en ' || coalesce(_cls,'clase'),
      NEW.user_id,'booking',NEW.id,NULL,
      jsonb_build_object('status',NEW.status,'seat',NEW.seat_number));
  ELSE
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      PERFORM public.log_activity('reservas',
        CASE WHEN NEW.status = 'cancelada' THEN 'cancelacion' ELSE 'cambio_estado' END,
        _who || ' · ' || OLD.status || ' → ' || NEW.status || ' en ' || coalesce(_cls,'clase'),
        NEW.user_id,'booking',NEW.id,NULL,jsonb_build_object('from',OLD.status,'to',NEW.status));
    END IF;
    IF NEW.seat_number IS DISTINCT FROM OLD.seat_number AND NEW.seat_number IS NOT NULL THEN
      PERFORM public.log_activity('reservas','asignacion_lugar',
        _who || ' · lugar ' || NEW.seat_number || ' en ' || coalesce(_cls,'clase'),
        NEW.user_id,'booking',NEW.id,NULL,jsonb_build_object('seat',NEW.seat_number));
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER log_booking AFTER INSERT OR UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.trg_log_booking();

-- check_ins (asistencia)
CREATE OR REPLACE FUNCTION public.trg_log_checkin() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid; _who text; _cls text;
BEGIN
  SELECT b.user_id, coalesce(c.module_key,'clase') || ' ' || to_char(c.starts_at,'DD/MM HH24:MI')
    INTO _uid, _cls
    FROM public.bookings b JOIN public.classes c ON c.id = b.class_id WHERE b.id = NEW.booking_id;
  _who := coalesce(public.person_label(_uid),'Usuario');
  PERFORM public.log_activity('asistencia',
    CASE WHEN NEW.status = 'no_show' THEN 'no_asistio' ELSE 'check_in' END,
    _who || ' · ' || CASE WHEN NEW.status = 'no_show' THEN 'no asistió' ELSE 'check-in' END ||
    ' en ' || coalesce(_cls,'clase'),
    _uid,'check_in',NEW.id,NULL,jsonb_build_object('status',NEW.status));
  RETURN NEW;
END; $$;
CREATE TRIGGER log_checkin AFTER INSERT OR UPDATE ON public.check_ins
  FOR EACH ROW EXECUTE FUNCTION public.trg_log_checkin();

-- pos_sales (ventas de merch / insumos)
CREATE OR REPLACE FUNCTION public.trg_log_pos_sale() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.total_cents = OLD.total_cents THEN RETURN NEW; END IF;
  PERFORM public.log_activity('ventas','venta_pos',
    'Venta en punto de venta (' || NEW.payment_method || ')' ||
    CASE WHEN NEW.user_id IS NOT NULL THEN ' · ' || coalesce(public.person_label(NEW.user_id),'') ELSE '' END,
    NEW.user_id,'pos_sale',NEW.id,NEW.total_cents,'{}'::jsonb);
  RETURN NEW;
END; $$;
CREATE TRIGGER log_pos_sale AFTER INSERT OR UPDATE ON public.pos_sales
  FOR EACH ROW EXECUTE FUNCTION public.trg_log_pos_sale();

-- inventory_movements (insumos)
CREATE OR REPLACE FUNCTION public.trg_log_inventory() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.log_activity('inventario',
    CASE WHEN NEW.delta >= 0 THEN 'entrada_insumo' ELSE 'salida_insumo' END,
    coalesce((SELECT name FROM public.products WHERE id = NEW.product_id),'Producto') || ': ' ||
    CASE WHEN NEW.delta >= 0 THEN '+' ELSE '' END || NEW.delta ||
    CASE WHEN NEW.reason <> '' THEN ' · ' || NEW.reason ELSE '' END,
    NULL,'product',NEW.product_id,NULL,jsonb_build_object('delta',NEW.delta));
  RETURN NEW;
END; $$;
CREATE TRIGGER log_inventory AFTER INSERT ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.trg_log_inventory();

-- products (modificaciones de catálogo)
CREATE OR REPLACE FUNCTION public.trg_log_product() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_activity('modificaciones','producto_creado','Producto creado: ' || NEW.name,
      NULL,'product',NEW.id,NEW.price_cents,'{}'::jsonb);
  ELSIF NEW.price_cents IS DISTINCT FROM OLD.price_cents OR NEW.active IS DISTINCT FROM OLD.active
     OR NEW.name IS DISTINCT FROM OLD.name THEN
    PERFORM public.log_activity('modificaciones','producto_editado','Producto actualizado: ' || NEW.name,
      NULL,'product',NEW.id,NEW.price_cents,
      jsonb_build_object('active',NEW.active,'price_cents',NEW.price_cents));
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER log_product AFTER INSERT OR UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.trg_log_product();

-- classes (agenda)
CREATE OR REPLACE FUNCTION public.trg_log_class() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.log_activity('clases','clase_borrada',
      coalesce(OLD.module_key,'clase') || ' ' || to_char(OLD.starts_at,'DD/MM HH24:MI') || ' eliminada',
      NULL,'class',OLD.id,NULL,'{}'::jsonb);
    RETURN OLD;
  ELSIF TG_OP = 'INSERT' THEN
    PERFORM public.log_activity('clases','clase_creada',
      coalesce(NEW.module_key,'clase') || ' ' || to_char(NEW.starts_at,'DD/MM HH24:MI') || ' · ' || NEW.instructor,
      NULL,'class',NEW.id,NULL,'{}'::jsonb);
  ELSE
    PERFORM public.log_activity('clases','clase_editada',
      coalesce(NEW.module_key,'clase') || ' ' || to_char(NEW.starts_at,'DD/MM HH24:MI') || ' actualizada',
      NULL,'class',NEW.id,NULL,
      jsonb_build_object('capacity',NEW.capacity,'instructor',NEW.instructor,'active',NEW.active));
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER log_class AFTER INSERT OR UPDATE OR DELETE ON public.classes
  FOR EACH ROW EXECUTE FUNCTION public.trg_log_class();