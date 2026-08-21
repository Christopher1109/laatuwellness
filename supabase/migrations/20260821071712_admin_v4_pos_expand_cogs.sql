-- ============================================================================
-- FASE 4:
--   1) costo del producto (para poder calcular margen real de mercancía en
--      Finanzas: ingreso - costo de lo vendido, no solo ingreso - nómina)
--   2) ampliar catálogo del Recovery Bar / punto de venta: paletas, yogurts,
--      granola, proteína, smoothies — con cantidades y fechas de caducidad
-- ============================================================================

alter table public.products
  add column if not exists cost_cents int not null default 0 check (cost_cents >= 0);
comment on column public.products.cost_cents is
  'Costo de compra por unidad (para calcular margen bruto real en Finanzas)';

-- backfill aproximado (60% del precio de venta) sobre lo ya sembrado, para
-- que el desglose de Finanzas no arranque en cero mientras capturan el
-- costo real de cada producto
update public.products set cost_cents = round(price_cents * 0.6)
where cost_cents = 0;

insert into public.products
  (name, sku, category, price_cents, cost_cents, stock, low_stock_threshold, unit, unit_size, expires_at, active)
values
  -- Paletas / helados
  ('Paleta de fresa con yogurt','RB-PALE-FRESA','consumible',3500,1400,24,8,'pieza','80 g',current_date + 45,true),
  ('Paleta de mango con chile','RB-PALE-MANGO','consumible',3500,1400,24,8,'pieza','80 g',current_date + 45,true),
  ('Paleta de coco','RB-PALE-COCO','consumible',3500,1400,20,8,'pieza','80 g',current_date + 45,true),
  -- Yogurts
  ('Yogurt griego natural','RB-YOG-NAT','consumible',4500,2000,18,6,'pieza','200 g',current_date + 14,true),
  ('Yogurt griego con granola y miel','RB-YOG-GRAN','consumible',5800,2600,18,6,'pieza','250 g',current_date + 10,true),
  ('Yogurt con frutos rojos','RB-YOG-BERRY','consumible',5800,2600,16,6,'pieza','250 g',current_date + 10,true),
  -- Granola
  ('Granola artesanal (bolsa)','RB-GRA-BAG','merch',9500,4200,15,5,'pieza','300 g',current_date + 120,true),
  ('Granola porción individual','RB-GRA-CUP','consumible',3800,1600,25,8,'pieza','50 g',current_date + 120,true),
  -- Proteína (polvo, además de las barras/shakes ya sembrados)
  ('Proteína whey vainilla (bote)','RB-PROT-VAN','merch',89000,45000,6,2,'pieza','900 g',current_date + 300,true),
  ('Proteína whey chocolate (bote)','RB-PROT-CHOC','merch',89000,45000,6,2,'pieza','900 g',current_date + 300,true),
  ('Proteína vegana (bote)','RB-PROT-VEG','merch',95000,48000,4,2,'pieza','800 g',current_date + 300,true),
  -- Smoothies (además del licuado verde ya sembrado)
  ('Smoothie mango-piña','RB-SMOO-MANGO','consumible',7200,3000,14,5,'pieza','400 ml',current_date + 3,true),
  ('Smoothie berries','RB-SMOO-BERRY','consumible',7200,3000,14,5,'pieza','400 ml',current_date + 3,true),
  ('Smoothie proteico post-clase','RB-SMOO-PROT','consumible',8500,3600,12,5,'pieza','400 ml',current_date + 3,true)
on conflict do nothing;

-- costo aproximado (60%) para los productos ya sembrados en la fase 3 que
-- quedaron con cost_cents en 0 tras el backfill anterior (por si el orden
-- de migraciones difiere)
update public.products set cost_cents = round(price_cents * 0.6) where cost_cents = 0;
