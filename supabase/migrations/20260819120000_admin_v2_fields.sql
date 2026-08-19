-- Fase 2: campos adicionales para inventario "profesional" y checador con geolocalización

alter table public.products
  add column if not exists unit text not null default 'pieza',
  add column if not exists unit_size text not null default '';
-- unit: pieza | caja | kg | g | l | ml | dosis
comment on column public.products.unit is 'Unidad de medida: pieza, caja, kg, g, l, ml, dosis';
comment on column public.products.unit_size is 'Presentación, ej. "500 ml", "30 dosis", "caja c/12"';

alter table public.time_clock_entries
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;
