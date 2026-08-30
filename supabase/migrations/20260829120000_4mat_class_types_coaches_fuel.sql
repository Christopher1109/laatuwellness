-- ============================================================================
-- FASE: Segundo salón (4mat), catálogo de tipos de clase, coaches reales
-- y renombre de "Recovery Bar" a "Fuel".
--
-- Todos los UPDATE de esta migración hacen match contra los valores de seed
-- originales (o contra valores ya migrados por esta misma migración), por lo
-- que es segura de correr aunque el dato ya se haya editado manualmente desde
-- el panel admin: si no encuentra el valor esperado, simplemente no toca nada.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Recovery Bar -> Fuel
-- ----------------------------------------------------------------------------
update public.site_modules
set key = 'fuel',
    name = 'Fuel',
    description = 'Smoothies de proteína, café y matcha de especialidad para recuperar después de entrenar.',
    long_description = 'Fuel vive dentro del estudio. Smoothies, café y matcha de especialidad pensados para lo que tu cuerpo necesita justo después de la clase. Se ordena y se paga en el estudio.'
where key = 'recovery-bar';

insert into public.site_modules (key, name, category, description, long_description, enabled, sort_order, bookable)
select 'fuel', 'Fuel', 'bar',
  'Smoothies de proteína, café y matcha de especialidad para recuperar después de entrenar.',
  'Fuel vive dentro del estudio. Smoothies, café y matcha de especialidad pensados para lo que tu cuerpo necesita justo después de la clase. Se ordena y se paga en el estudio.',
  true, 7, false
where not exists (select 1 from public.site_modules where key = 'fuel');

-- ----------------------------------------------------------------------------
-- 2) Segundo salón: "salon-2" (placeholder, deshabilitado) -> "4mat" (real)
-- ----------------------------------------------------------------------------
update public.site_modules
set key = '4mat',
    name = '4mat',
    description = 'Clases de piso en 4mat: fuerza funcional, movilidad y yoga.',
    long_description = 'Segundo salón de Läätu. Trabajo de piso pensado para complementar el reformer: fuerza funcional, movilidad y yoga en clases de grupo.',
    enabled = true
where key = 'salon-2';

insert into public.site_modules (key, name, category, description, long_description, enabled, sort_order, bookable)
select '4mat', '4mat', 'salon',
  'Clases de piso en 4mat: fuerza funcional, movilidad y yoga.',
  'Segundo salón de Läätu. Trabajo de piso pensado para complementar el reformer: fuerza funcional, movilidad y yoga en clases de grupo.',
  true, 2, true
where not exists (select 1 from public.site_modules where key = '4mat');

-- cualquier clase que ya se haya agendado bajo el key viejo se migra
update public.classes set module_key = '4mat' where module_key = 'salon-2';

-- ----------------------------------------------------------------------------
-- 3) Catálogo de tipos de clase (nombre real de la clase, distinto del salón)
-- ----------------------------------------------------------------------------
create table if not exists public.class_types (
  id uuid primary key default gen_random_uuid(),
  module_key text not null,
  name text not null,
  description text not null default '',
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (module_key, name)
);
grant select on public.class_types to anon, authenticated;
grant insert, update, delete on public.class_types to authenticated;
grant all on public.class_types to service_role;
alter table public.class_types enable row level security;

create policy "class_types_public_read" on public.class_types for select to anon, authenticated
  using (active or public.has_role(auth.uid(), 'admin'));
create policy "class_types_admin_write" on public.class_types for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

-- Reformer: nombres ya definidos por Christopher (sin la palabra "pilates" obligatoria
-- en todas, tal como se pidió).
-- 4mat: Strong Start / Release / Yoga ya definidos. Dynamat existe como concepto pero
-- se deja creado e inactivo (active=false) para cuando se decida activarlo.
insert into public.class_types (module_key, name, description, active, sort_order) values
  ('reformer', 'Classic Pilates', '', true, 1),
  ('reformer', 'Athletic Pilates', '', true, 2),
  ('reformer', 'Tower Pilates', '', true, 3),
  ('reformer', 'Circuit Pilates', '', true, 4),
  ('4mat', 'Strong Start', '', true, 1),
  ('4mat', 'Release', '', true, 2),
  ('4mat', 'Yoga', '', true, 3),
  ('4mat', 'Dynamat', '', false, 4)
on conflict (module_key, name) do nothing;

-- Liga opcional de cada sesión agendada a un tipo de clase del catálogo.
-- Nullable a propósito: las clases ya agendadas siguen funcionando sin este dato,
-- y el admin puede ir asignándolo desde el panel de horarios.
alter table public.classes add column if not exists class_type_id uuid references public.class_types(id) on delete set null;

-- ----------------------------------------------------------------------------
-- 4) Coaches reales
--    Roster: Moni, Lore, Jocelyn (Joce), Roberto, Gloria, Jhoana, Betzy, Nancy,
--    Montse, Mafe.
--    NOTA: no se inventan bios/especialidades — se dejan en blanco para que se
--    llenen desde el panel admin con la info real de cada coach.
-- ----------------------------------------------------------------------------

-- 4a) Tabla pública (bios en /coaches) — UPDATE en sitio para no romper nada
--     que dependa del id, + INSERT de las que falten.
update public.coaches set name = 'Moni', specialty = '', bio = '' where name = 'Ana Ruiz';
update public.coaches set name = 'Lore', specialty = '', bio = '' where name = 'Sofía Lara';
update public.coaches set name = 'Jocelyn (Joce)', specialty = '', bio = '' where name = 'Renata Vidal';
update public.coaches set name = 'Roberto', specialty = '', bio = '' where name = 'Camila Ortiz';

insert into public.coaches (name, specialty, bio, active, sort_order)
select v.name, '', '', true, v.sort_order
from (values
  ('Gloria', 5),
  ('Jhoana', 6),
  ('Betzy', 7),
  ('Nancy', 8),
  ('Montse', 9),
  ('Mafe', 10)
) as v(name, sort_order)
where not exists (select 1 from public.coaches c where c.name = v.name);

-- 4b) Tabla operativa (staff_profiles, role='coach').
--     UPDATE en sitio (por email de seed) para preservar el id: varias tablas
--     (time_clock_entries, shift_slots, shift_claims, payroll_adjustments)
--     referencian staff_profiles(id) ON DELETE CASCADE, así que un DELETE aquí
--     borraría en cascada cualquier historial ya ligado a esos ids.
update public.staff_profiles set full_name = 'Moni', email = 'moni@laatuwellness.com' where email = 'ana.ruiz@laatuwellness.com';
update public.staff_profiles set full_name = 'Lore', email = 'lore@laatuwellness.com' where email = 'sofia.lara@laatuwellness.com';
update public.staff_profiles set full_name = 'Jocelyn (Joce)', email = 'jocelyn@laatuwellness.com' where email = 'renata.vidal@laatuwellness.com';
update public.staff_profiles set full_name = 'Roberto', email = 'roberto@laatuwellness.com' where email = 'camila.ortiz@laatuwellness.com';
update public.staff_profiles set full_name = 'Gloria', email = 'gloria@laatuwellness.com' where email = 'coach5@laatuwellness.com';
update public.staff_profiles set full_name = 'Jhoana', email = 'jhoana@laatuwellness.com' where email = 'coach6@laatuwellness.com';
update public.staff_profiles set full_name = 'Betzy', email = 'betzy@laatuwellness.com' where email = 'coach7@laatuwellness.com';
update public.staff_profiles set full_name = 'Nancy', email = 'nancy@laatuwellness.com' where email = 'coach8@laatuwellness.com';
update public.staff_profiles set full_name = 'Montse', email = 'montse@laatuwellness.com' where email = 'coach9@laatuwellness.com';

insert into public.staff_profiles (full_name, email, role, hourly_rate_cents, active)
select 'Mafe', 'mafe@laatuwellness.com', 'coach', 15000, true
where not exists (select 1 from public.staff_profiles where email = 'mafe@laatuwellness.com');
