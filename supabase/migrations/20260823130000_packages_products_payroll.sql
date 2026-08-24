-- ============================================================================
-- PAQUETES (token_plans) — menú real Läätu: Class Packages, Memberships,
-- Align, Contrast. Reemplaza los paquetes de ejemplo.
-- ============================================================================
ALTER TABLE public.token_plans ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'clases_pilates';
ALTER TABLE public.token_plans ADD COLUMN IF NOT EXISTS subtitle text NOT NULL DEFAULT '';
ALTER TABLE public.token_plans ADD COLUMN IF NOT EXISTS includes text NOT NULL DEFAULT '';
ALTER TABLE public.token_plans ADD COLUMN IF NOT EXISTS terms text NOT NULL DEFAULT '';

-- Los paquetes de ejemplo del arranque del proyecto se desactivan (no se
-- borran, por si alguna transacción histórica los referencia).
UPDATE public.token_plans SET active = false
WHERE name IN ('Drop In', 'Pack 10', 'Membresía Mensual');

INSERT INTO public.token_plans
  (name, description, subtitle, category, tokens, price_cents, recurring, validity_days, active, sort_order, includes, terms)
VALUES
  ('Newcomer', 'Primera clase, precio de bienvenida.', 'First class only · Reformer / 4mat',
   'clases_pilates', 1, 33000, false, 15, true, 1, '', 'Solo puede usarse una vez por cliente nuevo.'),
  ('Single', 'Una clase suelta.', 'Reformer / 4mat',
   'clases_pilates', 1, 37000, false, 15, true, 2, '', ''),
  ('3 Classes', 'Tres clases, vigencia de 15 días.', 'Reformer / 4mat',
   'clases_pilates', 3, 106000, false, 15, true, 3, '', ''),
  ('5 Classes', 'Cinco clases, vigencia de 30 días.', 'Reformer / 4mat',
   'clases_pilates', 5, 175000, false, 30, true, 4, '', ''),
  ('10 Classes', 'Diez clases, vigencia de 45 días.', 'Reformer / 4mat',
   'clases_pilates', 10, 345000, false, 45, true, 5, '', ''),
  ('Choose Your Way', 'Una clase al día de tu elección, se renueva mensual.', 'Se renueva mensual · 1 class per day',
   'clases_pilates', 30, 620000, true, 30, true, 6, '', 'Cargo mensual recurrente.'),
  ('Double Up / Mix & Match', 'Dos clases al día, Reformer y 4mat combinados.', 'Se renueva mensual · Reformer & 4mat',
   'clases_pilates', 60, 800000, true, 30, true, 7, '', 'Solo puede usarse por una persona.'),
  ('The OGs', 'Membresía fundadora: Double Up/Mix & Match + Align + Contrast + Fuel.', 'Cupo limitado a 25 membresías',
   'membresia', 60, 950000, true, 30, true, 8,
   '1 Align · Doris Fisio · 40 min' || E'\n' || '2 Contrast · 40 min por sesión' || E'\n' || '1 Fuel Coffee + Smoothie',
   'Solo habrá 25 membresías a este precio. Una vez cancelada se pierde la membresía. Cargo mensual recurrente por un mínimo de 6 meses. Se puede congelar hasta 2 semanas al año.'),
  ('Two a Day Your Way', 'Double Up/Mix & Match + Align + Contrast + Fuel.', 'Se renueva mensual',
   'membresia', 60, 1100000, true, 30, true, 9,
   '1 Align · Doris Fisio · 40 min' || E'\n' || '2 Contrast · 40 min por sesión' || E'\n' || '1 Fuel Coffee + Smoothie',
   'Cargo mensual recurrente por un mínimo de 6 meses. Se puede congelar hasta 2 semanas al año.'),
  ('The Everyday', 'Choose Your Way + Align con descuento + Contrast + Fuel.', 'Se renueva mensual',
   'membresia', 30, 900000, true, 30, true, 10,
   '50% off Align · Doris Fisio (descuento de $425) · 40 min' || E'\n' || '1 Contrast · 30 min' || E'\n' || '1 Fuel Smoothie OR Coffee',
   'Cargo mensual recurrente por un mínimo de 6 meses. Se puede congelar hasta 2 semanas al año.'),
  ('Align — Doris Fisio', 'Descarga muscular, 40 min.', 'Fisioterapia individual',
   'consulta', 1, 85000, false, 30, true, 11, '', 'Sujeto a disponibilidad y reservas en calendario.'),
  ('Contrast', 'Terapia de sauna infrarrojo y cold plunge, 30 min.', 'Recovery',
   'recuperacion', 1, 60000, false, 30, true, 12, '', 'Puede ser usada por un máximo de 2 personas a la vez. Sujeto a disponibilidad.')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- Compra de créditos hecha por el staff a nombre de un cliente (usada desde
-- el panel de clientes al agregar créditos directo).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_purchase_plan(_user_id uuid, _plan_id uuid, _payment_method text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _p public.token_plans;
  _tx uuid;
BEGIN
  IF NOT (public.is_staff(auth.uid()) OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  SELECT * INTO _p FROM public.token_plans WHERE id = _plan_id AND active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PLAN_NOT_FOUND';
  END IF;
  INSERT INTO public.transactions (user_id, plan_id, amount_cents, tokens, currency, payment_method, status)
    VALUES (_user_id, _p.id, _p.price_cents, _p.tokens, _p.currency, COALESCE(_payment_method, 'pendiente'), 'completed')
    RETURNING id INTO _tx;
  INSERT INTO public.token_ledger (user_id, delta, reason, transaction_id, created_by)
    VALUES (_user_id, _p.tokens, 'Compra en estudio: ' || _p.name, _tx, auth.uid());
  RETURN _tx;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_purchase_plan(uuid, uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_purchase_plan(uuid, uuid, text) TO authenticated;

-- ============================================================================
-- PRODUCTOS DE PUNTO DE VENTA / INVENTARIO — Recovery Bar, merch y bebidas.
-- ============================================================================
INSERT INTO public.products (name, sku, category, price_cents, cost_cents, stock, low_stock_threshold, active)
VALUES
  ('Barrita de proteína', 'REC-BAR-01', 'consumible', 6500, 3200, 40, 10, true),
  ('Smoothie de proteína', 'REC-SMO-01', 'consumible', 9500, 4000, 25, 8, true),
  ('Shot de proteína', 'REC-PRO-01', 'consumible', 8000, 3500, 20, 6, true),
  ('Agua natural 600ml', 'REC-AGU-01', 'consumible', 2500, 900, 60, 15, true),
  ('Gatorade', 'REC-GAT-01', 'consumible', 4000, 1800, 30, 10, true),
  ('Powerade', 'REC-POW-01', 'consumible', 4000, 1800, 30, 10, true),
  ('Coca-Cola', 'REC-COC-01', 'consumible', 3500, 1500, 30, 10, true),
  ('Café de especialidad', 'REC-CAF-01', 'consumible', 5500, 2000, 999, 20, true),
  ('Playera Läätu', 'MER-PLA-01', 'merch', 45000, 18000, 20, 5, true),
  ('Gorra Läätu', 'MER-GOR-01', 'merch', 38000, 15000, 20, 5, true),
  ('Calcetines de grip', 'MER-CAL-01', 'merch', 25000, 9000, 30, 8, true),
  ('Bolsa deportiva Läätu', 'MER-BOL-01', 'merch', 65000, 26000, 12, 4, true),
  ('Tenis de estudio', 'MER-TEN-01', 'merch', 120000, 55000, 10, 3, true)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- NÓMINA POR PLANTILLA DE EXCEL — reemplaza el cálculo por checador.
-- El staff sube un Excel (nombre/correo + horas trabajadas del periodo) y el
-- sistema empareja por correo (o nombre) contra staff_profiles.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.payroll_period_hours (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff_profiles(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  hours numeric(6,2) not null default 0,
  source text not null default 'excel_upload',
  uploaded_by uuid,
  created_at timestamptz not null default now(),
  unique (staff_id, period_start, period_end)
);

ALTER TABLE public.payroll_period_hours ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payroll_hours_staff_admin_all" ON public.payroll_period_hours FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.is_staff(auth.uid()))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.is_staff(auth.uid()));

GRANT ALL ON public.payroll_period_hours TO authenticated;
GRANT ALL ON public.payroll_period_hours TO service_role;
