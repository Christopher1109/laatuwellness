-- Datos operativos de Läätu (idempotente):
-- 1) Colores de coach del horario de Läätu.
-- 2) Productos Goddess Rituals y Läätu sin duplicar los existentes.
-- 3) Tipos de clase de 4mat (Barre, Dynamat activo).
-- 4) Founders Access empieza a correr el lunes 2 de noviembre de 2026.
-- 5) Patrón de noviembre según el horario de Reformer y 4mat.

-- 1) Colores (solo si no se han personalizado)
UPDATE public.staff_profiles s SET color = v.color
FROM (VALUES
  ('Moni', '#D165C7'), ('Lore', '#EDC9E8'), ('Roberto', '#4A86C8'), ('Montse', '#F2B21B'),
  ('Jhoana', '#D5EAD1'), ('Gloria', '#F6D6C9'), ('Betzy', '#47C64A'), ('Rebe', '#7320F0'),
  ('Nancy', '#D7E1EF'), ('Eli', '#18EDED'), ('Mafe', '#FFF200'), ('Priscy', '#F2566C')
) AS v(name, color)
WHERE s.role = 'coach' AND s.full_name = v.name AND s.color IS NULL;

-- 2) Productos. Goddess Rituals ya existían; solo se homologan nombres.
UPDATE public.products SET name = 'Replenish Extra Fresa'
  WHERE brand = 'goodes' AND trim(name) = 'Extra Fresa';
UPDATE public.products SET name = 'Replenish Extra Citrus'
  WHERE brand = 'goodes' AND trim(name) = 'Extra Citrus';
UPDATE public.products SET name = 'Beauty Sleep Pink Lemonade'
  WHERE brand = 'goodes' AND name = 'Beauty Sleep Pink Lemonade ';
UPDATE public.products SET name = 'Bebida G Rituals Citricos'
  WHERE brand = 'goodes' AND name = 'Bebida GRituals Citricos';
UPDATE public.products SET name = 'Caja Bebida G Rituals Citricos'
  WHERE brand = 'goodes' AND name = 'Caja  Bebida GRituals Citricos';
-- Precios según la lista de Goddess Rituals
UPDATE public.products p SET price_cents = v.price
FROM (VALUES
  ('Replenish Blueberry', 70000), ('Replenish Watermelon', 70000),
  ('Replenish Extra Fresa', 85000), ('Replenish Extra Citrus', 85000),
  ('Beauty Sleep Pink Lemonade', 70000), ('Beauty Sleep Berry Splash', 70000),
  ('Bebida G Rituals Citricos', 7000), ('Bebida G Rituals Fresa', 7000),
  ('Caja Bebida G Rituals Citricos', 80000), ('Caja Bebida G Rituals Fresa', 80000)
) AS v(name, price)
WHERE p.brand = 'goodes' AND p.name = v.name AND p.price_cents <> v.price;
-- Läätu: los calcetines de grip existentes ($250) son los genéricos.
UPDATE public.products SET name = 'Calcetines Generic'
  WHERE brand = 'laatu' AND sku = 'MER-CAL-01' AND name = 'Calcetines de grip';
INSERT INTO public.products (name, sku, category, brand, price_cents, cost_cents, stock, low_stock_threshold, active, unit)
SELECT v.name, v.sku, 'merch', 'laatu', v.price, 0, 0, 2, true, 'pieza'
FROM (VALUES
  ('Calcetines Laatu', 'MER-CAL-02', 27000),
  ('Toalla para mat', 'MER-TOA-01', 30000)
) AS v(name, sku, price)
WHERE NOT EXISTS (SELECT 1 FROM public.products p WHERE lower(p.name) = lower(v.name) OR p.sku = v.sku);

-- 3) Tipos de clase de 4mat
INSERT INTO public.class_types (module_key, name, description, active, sort_order)
SELECT '4mat', 'Barre', '', true, 0
WHERE NOT EXISTS (SELECT 1 FROM public.class_types WHERE module_key = '4mat' AND lower(name) = 'barre');
UPDATE public.class_types SET active = true WHERE module_key = '4mat' AND name = 'Dynamat' AND NOT active;

-- 4) Founders Access: la mensualidad corre desde el lunes 2 de noviembre.
UPDATE public.token_plans
SET membership_starts_at = '2026-11-02 00:00:00 America/Monterrey'::timestamptz,
    terms = replace(terms, 'Vigencia de 30 días naturales desde la compra.', 'Vigencia de 30 días naturales a partir del lunes 2 de noviembre de 2026.')
WHERE id = 'b4302499-2791-4d01-bde8-345ccfc0d59d';
UPDATE public.transactions t
SET access_starts_at = public.purchase_validity_start(t.created_at, '2026-11-02 00:00:00 America/Monterrey'::timestamptz),
    access_ends_at = public.membership_end(public.purchase_validity_start(t.created_at, '2026-11-02 00:00:00 America/Monterrey'::timestamptz), 30)
WHERE t.plan_id = 'b4302499-2791-4d01-bde8-345ccfc0d59d'
  AND t.status = 'completed'
  AND t.access_starts_at < '2026-11-02 00:00:00 America/Monterrey'::timestamptz;

-- 5) Patrón de noviembre (weekday 0 = lunes)
INSERT INTO public.schedule_templates (module_key, month, weekday, start_time, actual_start, coach_id, class_type_id, is_tbd, is_rotation, active, room, capacity, duration_min)
SELECT v.module_key, '2026-11-01'::date, v.weekday, v.start_time::time, v.actual_start::time,
       (SELECT s.id FROM public.staff_profiles s WHERE s.role = 'coach' AND s.full_name = v.coach LIMIT 1),
       (SELECT ct.id FROM public.class_types ct WHERE ct.module_key = v.module_key AND ct.name = v.class_type LIMIT 1),
       v.is_tbd, v.is_rotation, true,
       CASE WHEN v.module_key = 'reformer' THEN 'Reformer' ELSE '4mat' END, 10, 50
FROM (VALUES
  -- Reformer: por definir y rotación de fin de semana
  ('reformer', 0, '10:00', NULL, NULL, NULL, true, false),
  ('reformer', 0, '11:00', NULL, NULL, NULL, true, false),
  ('reformer', 0, '19:10', NULL, NULL, NULL, true, false),
  ('reformer', 2, '07:00', NULL, NULL, NULL, true, false),
  ('reformer', 2, '08:00', NULL, NULL, NULL, true, false),
  ('reformer', 4, '17:00', NULL, NULL, NULL, true, false),
  ('reformer', 4, '18:15', NULL, NULL, NULL, true, false),
  ('reformer', 5, '09:00', NULL, NULL, NULL, false, true),
  ('reformer', 5, '10:00', NULL, NULL, NULL, false, true),
  ('reformer', 5, '11:00', NULL, NULL, NULL, false, true),
  ('reformer', 6, '09:00', NULL, NULL, NULL, false, true),
  ('reformer', 6, '10:00', NULL, NULL, NULL, false, true),
  ('reformer', 6, '11:00', NULL, NULL, NULL, false, true),
  -- 4mat
  ('4mat', 1, '08:00', NULL, 'Eli', 'Barre', false, false),
  ('4mat', 2, '08:00', NULL, 'Eli', 'Barre', false, false),
  ('4mat', 4, '08:00', '08:15', 'Mafe', 'Yoga', false, false),
  ('4mat', 0, '09:15', NULL, NULL, 'Strong Start', true, false),
  ('4mat', 1, '09:15', NULL, NULL, 'Strong Start', true, false),
  ('4mat', 2, '09:15', NULL, NULL, 'Strong Start', true, false),
  ('4mat', 3, '09:15', NULL, NULL, 'Strong Start', true, false),
  ('4mat', 4, '09:15', NULL, NULL, 'Dynamat', true, false),
  ('4mat', 0, '10:10', NULL, 'Moni', 'Barre', false, false),
  ('4mat', 1, '10:10', NULL, 'Priscy', 'Barre', false, false),
  ('4mat', 2, '10:10', NULL, NULL, 'Dynamat', true, false),
  ('4mat', 3, '10:10', NULL, 'Moni', 'Barre', false, false),
  ('4mat', 6, '10:10', NULL, 'Mafe', 'Yoga', false, false),
  ('4mat', 0, '11:10', NULL, NULL, 'Strong Start', true, false),
  ('4mat', 1, '11:10', NULL, NULL, 'Strong Start', true, false),
  ('4mat', 2, '11:10', NULL, NULL, 'Strong Start', true, false),
  ('4mat', 3, '11:10', NULL, NULL, 'Strong Start', true, false),
  ('4mat', 4, '11:10', NULL, 'Moni', 'Barre', false, false),
  ('4mat', 1, '18:00', '18:15', 'Nancy', 'Barre', false, false),
  ('4mat', 2, '18:00', '18:15', 'Mafe', 'Yoga', false, false)
) AS v(module_key, weekday, start_time, actual_start, coach, class_type, is_tbd, is_rotation)
ON CONFLICT (module_key, weekday, start_time, month) DO UPDATE
SET actual_start = EXCLUDED.actual_start,
    coach_id = EXCLUDED.coach_id,
    class_type_id = EXCLUDED.class_type_id,
    is_tbd = EXCLUDED.is_tbd,
    is_rotation = EXCLUDED.is_rotation,
    active = true
WHERE public.schedule_templates.active = false OR public.schedule_templates.module_key = '4mat';

-- Torre (*) en Reformer: martes Lore/Roberto y jueves Moni 7 y 8.
UPDATE public.schedule_templates t
SET class_type_id = (SELECT id FROM public.class_types WHERE module_key = 'reformer' AND name = 'Tower Pilates' LIMIT 1)
WHERE t.module_key = 'reformer' AND t.month = '2026-11-01' AND t.class_type_id IS NULL
  AND ((t.weekday = 1 AND t.start_time IN ('07:00', '08:00', '09:00', '10:00', '11:00'))
    OR (t.weekday = 3 AND t.start_time IN ('07:00', '08:00')));
