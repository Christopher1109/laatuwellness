-- ============================================================================
-- FASE 2: Zona administrativa/operativa
-- POS, Inventario, Check-in, Nómina, Horarios de Staff, Perfiles de Coach
-- ============================================================================

-- ROLES: agregamos 'staff' (front desk / operación) y 'coach' (instructoras)
-- (los valores del enum se agregaron en una migración previa)

-- ----------------------------------------------------------------------------
-- STAFF PROFILES (equipo operativo: admins, staff, coaches)
-- ----------------------------------------------------------------------------
create table public.staff_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null default '',
  phone text,
  role public.app_role not null default 'staff',
  hourly_rate_cents int not null default 0 check (hourly_rate_cents >= 0),
  photo_url text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
grant select on public.staff_profiles to authenticated;
grant insert, update, delete on public.staff_profiles to authenticated;
grant all on public.staff_profiles to service_role;
alter table public.staff_profiles enable row level security;

create policy "staff_profiles_select" on public.staff_profiles for select to authenticated
  using (auth.uid() = user_id or public.has_role(auth.uid(),'admin'));
create policy "staff_profiles_admin_write" on public.staff_profiles for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

create or replace function public.is_staff(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.staff_profiles
    where user_id = _user_id and active
      and role in ('admin','staff','coach')
  )
$$;

-- link clases a un coach real (se conserva "instructor" como texto de respaldo)
alter table public.classes add column if not exists coach_id uuid references public.staff_profiles(id) on delete set null;

-- ----------------------------------------------------------------------------
-- TIME CLOCK (entrada / salida con foto)
-- ----------------------------------------------------------------------------
create table public.time_clock_entries (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff_profiles(id) on delete cascade,
  type text not null check (type in ('in','out')),
  photo_url text,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index time_clock_staff_idx on public.time_clock_entries(staff_id, created_at);
grant select, insert on public.time_clock_entries to authenticated;
grant all on public.time_clock_entries to service_role;
alter table public.time_clock_entries enable row level security;

create policy "clock_select" on public.time_clock_entries for select to authenticated
  using (
    staff_id in (select id from public.staff_profiles where user_id = auth.uid())
    or public.has_role(auth.uid(),'admin')
  );
create policy "clock_insert_own" on public.time_clock_entries for insert to authenticated
  with check (staff_id in (select id from public.staff_profiles where user_id = auth.uid()));

-- ----------------------------------------------------------------------------
-- HORARIOS DE STAFF: turnos requeridos + disponibilidad/asignación
-- ----------------------------------------------------------------------------
create table public.shift_slots (
  id uuid primary key default gen_random_uuid(),
  weekday int not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  role_needed public.app_role not null default 'staff',
  notes text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
grant select on public.shift_slots to authenticated;
grant insert, update, delete on public.shift_slots to authenticated;
grant all on public.shift_slots to service_role;
alter table public.shift_slots enable row level security;
create policy "shift_slots_select" on public.shift_slots for select to authenticated
  using (public.is_staff(auth.uid()) or public.has_role(auth.uid(),'admin'));
create policy "shift_slots_admin_write" on public.shift_slots for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

create table public.shift_claims (
  id uuid primary key default gen_random_uuid(),
  shift_slot_id uuid not null references public.shift_slots(id) on delete cascade,
  staff_id uuid not null references public.staff_profiles(id) on delete cascade,
  status text not null default 'propuesto' check (status in ('propuesto','confirmado','rechazado')),
  created_at timestamptz not null default now(),
  unique (shift_slot_id, staff_id)
);
grant select, insert on public.shift_claims to authenticated;
grant update, delete on public.shift_claims to authenticated;
grant all on public.shift_claims to service_role;
alter table public.shift_claims enable row level security;

create policy "shift_claims_select" on public.shift_claims for select to authenticated
  using (
    staff_id in (select id from public.staff_profiles where user_id = auth.uid())
    or public.has_role(auth.uid(),'admin')
  );
create policy "shift_claims_insert_own" on public.shift_claims for insert to authenticated
  with check (staff_id in (select id from public.staff_profiles where user_id = auth.uid()));
create policy "shift_claims_delete_own" on public.shift_claims for delete to authenticated
  using (
    staff_id in (select id from public.staff_profiles where user_id = auth.uid())
    or public.has_role(auth.uid(),'admin')
  );
create policy "shift_claims_admin_update" on public.shift_claims for update to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- ----------------------------------------------------------------------------
-- NÓMINA
-- ----------------------------------------------------------------------------
create table public.payroll_adjustments (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff_profiles(id) on delete cascade,
  amount_cents int not null,
  reason text not null default '',
  created_by uuid,
  created_at timestamptz not null default now()
);
grant select on public.payroll_adjustments to authenticated;
grant insert, update, delete on public.payroll_adjustments to authenticated;
grant all on public.payroll_adjustments to service_role;
alter table public.payroll_adjustments enable row level security;

create policy "payroll_adj_select" on public.payroll_adjustments for select to authenticated
  using (
    staff_id in (select id from public.staff_profiles where user_id = auth.uid())
    or public.has_role(auth.uid(),'admin')
  );
create policy "payroll_adj_admin_write" on public.payroll_adjustments for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

create or replace function public.staff_worked_seconds(_staff_id uuid, _from timestamptz, _to timestamptz)
returns int language plpgsql stable security definer set search_path = public as $$
declare
  r record;
  clock_in timestamptz;
  total int := 0;
begin
  for r in
    select type, created_at from public.time_clock_entries
    where staff_id = _staff_id and created_at >= _from and created_at < _to
    order by created_at asc
  loop
    if r.type = 'in' then
      clock_in := r.created_at;
    elsif r.type = 'out' and clock_in is not null then
      total := total + extract(epoch from (r.created_at - clock_in))::int;
      clock_in := null;
    end if;
  end loop;
  return total;
end; $$;
revoke execute on function public.staff_worked_seconds(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.staff_worked_seconds(uuid, timestamptz, timestamptz) to authenticated;

-- ----------------------------------------------------------------------------
-- CHECK-IN de clientes en clase (asistencia)
-- ----------------------------------------------------------------------------
create table public.check_ins (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  checked_in_by uuid,
  status text not null default 'a_tiempo' check (status in ('a_tiempo','tarde','no_show')),
  created_at timestamptz not null default now()
);
grant select, insert, update on public.check_ins to authenticated;
grant all on public.check_ins to service_role;
alter table public.check_ins enable row level security;

create policy "check_ins_select" on public.check_ins for select to authenticated
  using (public.is_staff(auth.uid()) or public.has_role(auth.uid(),'admin'));
create policy "check_ins_staff_write" on public.check_ins for all to authenticated
  using (public.is_staff(auth.uid()) or public.has_role(auth.uid(),'admin'))
  with check (public.is_staff(auth.uid()) or public.has_role(auth.uid(),'admin'));

create or replace function public.mark_no_show(_booking_id uuid, _penalty_cents int default 0)
returns public.check_ins language plpgsql security definer set search_path = public as $$
declare _row public.check_ins;
begin
  if not (public.is_staff(auth.uid()) or public.has_role(auth.uid(),'admin')) then
    raise exception 'FORBIDDEN';
  end if;
  insert into public.check_ins (booking_id, checked_in_by, status)
    values (_booking_id, auth.uid(), 'no_show')
    on conflict (booking_id) do update set status = 'no_show', checked_in_by = auth.uid()
    returning * into _row;
  return _row;
end; $$;
revoke execute on function public.mark_no_show(uuid, int) from public, anon;
grant execute on function public.mark_no_show(uuid, int) to authenticated;

-- ----------------------------------------------------------------------------
-- INVENTARIO / TIENDA / POS
-- ----------------------------------------------------------------------------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sku text,
  category text not null default 'merch',
  price_cents int not null default 0 check (price_cents >= 0),
  stock int not null default 0,
  low_stock_threshold int not null default 5,
  expires_at date,
  image_url text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
grant select on public.products to anon, authenticated;
grant insert, update, delete on public.products to authenticated;
grant all on public.products to service_role;
alter table public.products enable row level security;
create policy "products_public_read" on public.products for select to anon, authenticated
  using (active or public.has_role(auth.uid(),'admin') or public.is_staff(auth.uid()));
create policy "products_admin_write" on public.products for all to authenticated
  using (public.has_role(auth.uid(),'admin') or public.is_staff(auth.uid()))
  with check (public.has_role(auth.uid(),'admin') or public.is_staff(auth.uid()));

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  delta int not null,
  reason text not null default '',
  created_by uuid,
  created_at timestamptz not null default now()
);
grant select, insert on public.inventory_movements to authenticated;
grant all on public.inventory_movements to service_role;
alter table public.inventory_movements enable row level security;
create policy "inv_mov_select" on public.inventory_movements for select to authenticated
  using (public.has_role(auth.uid(),'admin') or public.is_staff(auth.uid()));
create policy "inv_mov_insert" on public.inventory_movements for insert to authenticated
  with check (public.has_role(auth.uid(),'admin') or public.is_staff(auth.uid()));

create or replace function public.adjust_stock(_product_id uuid, _delta int, _reason text)
returns public.products language plpgsql security definer set search_path = public as $$
declare _row public.products;
begin
  if not (public.has_role(auth.uid(),'admin') or public.is_staff(auth.uid())) then
    raise exception 'FORBIDDEN';
  end if;
  insert into public.inventory_movements (product_id, delta, reason, created_by)
    values (_product_id, _delta, coalesce(_reason,''), auth.uid());
  update public.products set stock = stock + _delta where id = _product_id returning * into _row;
  return _row;
end; $$;
revoke execute on function public.adjust_stock(uuid, int, text) from public, anon;
grant execute on function public.adjust_stock(uuid, int, text) to authenticated;

create table public.pos_sales (
  id uuid primary key default gen_random_uuid(),
  sold_by uuid,
  user_id uuid references auth.users(id) on delete set null,
  total_cents int not null default 0,
  payment_method text not null default 'efectivo',
  created_at timestamptz not null default now()
);
grant select, insert on public.pos_sales to authenticated;
grant all on public.pos_sales to service_role;
alter table public.pos_sales enable row level security;
create policy "pos_sales_select" on public.pos_sales for select to authenticated
  using (public.has_role(auth.uid(),'admin') or public.is_staff(auth.uid()));
create policy "pos_sales_insert" on public.pos_sales for insert to authenticated
  with check (public.has_role(auth.uid(),'admin') or public.is_staff(auth.uid()));

create table public.pos_sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.pos_sales(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  description text not null default '',
  qty int not null default 1,
  unit_price_cents int not null default 0
);
grant select, insert on public.pos_sale_items to authenticated;
grant all on public.pos_sale_items to service_role;
alter table public.pos_sale_items enable row level security;
create policy "pos_items_select" on public.pos_sale_items for select to authenticated
  using (public.has_role(auth.uid(),'admin') or public.is_staff(auth.uid()));
create policy "pos_items_insert" on public.pos_sale_items for insert to authenticated
  with check (public.has_role(auth.uid(),'admin') or public.is_staff(auth.uid()));

create or replace function public.pos_checkout(_user_id uuid, _payment_method text, _items jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  _sale_id uuid;
  _item jsonb;
  _total int := 0;
  _unit int;
begin
  if not (public.has_role(auth.uid(),'admin') or public.is_staff(auth.uid())) then
    raise exception 'FORBIDDEN';
  end if;

  insert into public.pos_sales (sold_by, user_id, payment_method) values (auth.uid(), _user_id, coalesce(_payment_method,'efectivo'))
    returning id into _sale_id;

  for _item in select * from jsonb_array_elements(_items) loop
    _unit := (_item->>'unit_price_cents')::int;
    insert into public.pos_sale_items (sale_id, product_id, description, qty, unit_price_cents)
      values (_sale_id, nullif(_item->>'product_id','')::uuid, coalesce(_item->>'description',''), (_item->>'qty')::int, _unit);
    _total := _total + _unit * (_item->>'qty')::int;
    if (_item->>'product_id') is not null and (_item->>'product_id') <> '' then
      perform public.adjust_stock((_item->>'product_id')::uuid, -((_item->>'qty')::int), 'Venta POS ' || _sale_id);
    end if;
  end loop;

  update public.pos_sales set total_cents = _total where id = _sale_id;
  return _sale_id;
end; $$;
revoke execute on function public.pos_checkout(uuid, text, jsonb) from public, anon;
grant execute on function public.pos_checkout(uuid, text, jsonb) to authenticated;

revoke execute on function public.is_staff(uuid) from public, anon;
grant execute on function public.is_staff(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- SEED: staff (20 perfiles)
-- ----------------------------------------------------------------------------
insert into public.staff_profiles (full_name, email, role, hourly_rate_cents, active) values
('Admin Principal','admin@laatuwellness.com','admin',0,true),
('Ana Ruiz','ana.ruiz@laatuwellness.com','coach',15000,true),
('Sofía Lara','sofia.lara@laatuwellness.com','coach',15000,true),
('Renata Vidal','renata.vidal@laatuwellness.com','coach',15000,true),
('Camila Ortiz','camila.ortiz@laatuwellness.com','coach',15000,true),
('Staff Recepción 1','staff1@laatuwellness.com','staff',9000,true),
('Staff Recepción 2','staff2@laatuwellness.com','staff',9000,true),
('Staff Recepción 3','staff3@laatuwellness.com','staff',9000,true),
('Staff Recepción 4','staff4@laatuwellness.com','staff',9000,true),
('Staff Recepción 5','staff5@laatuwellness.com','staff',9000,true),
('Staff Recepción 6','staff6@laatuwellness.com','staff',9000,true),
('Staff Recepción 7','staff7@laatuwellness.com','staff',9000,true),
('Staff Recepción 8','staff8@laatuwellness.com','staff',9000,true),
('Staff Recepción 9','staff9@laatuwellness.com','staff',9000,true),
('Staff Recepción 10','staff10@laatuwellness.com','staff',9000,true),
('Coach 5','coach5@laatuwellness.com','coach',15000,true),
('Coach 6','coach6@laatuwellness.com','coach',15000,true),
('Coach 7','coach7@laatuwellness.com','coach',15000,true),
('Coach 8','coach8@laatuwellness.com','coach',15000,true),
('Coach 9','coach9@laatuwellness.com','coach',15000,true)
on conflict do nothing;

insert into public.products (name, sku, category, price_cents, stock, low_stock_threshold, active) values
('Playera Läätu','LTU-TSHIRT','merch',45000,20,5,true),
('Botella Läätu','LTU-BOTTLE','merch',35000,15,5,true),
('Tapete de yoga','LTU-MAT','merch',89000,8,3,true),
('Proteína en polvo','LTU-PROT','suplemento',65000,10,4,true)
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- LOGIN INTELIGENTE
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare _staff public.staff_profiles;
begin
  insert into public.profiles (id, full_name, email, phone)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''), coalesce(new.email,''), new.raw_user_meta_data->>'phone')
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role) values (new.id, 'user') on conflict do nothing;

  select * into _staff from public.staff_profiles
    where lower(email) = lower(coalesce(new.email,'')) and user_id is null
    limit 1;
  if found then
    update public.staff_profiles set user_id = new.id, full_name = coalesce(nullif(full_name,''), _staff.full_name)
      where id = _staff.id;
    insert into public.user_roles (user_id, role) values (new.id, _staff.role) on conflict do nothing;
  end if;

  return new;
end; $$;

create or replace function public.link_existing_staff_accounts()
returns void language plpgsql security definer set search_path = public as $$
declare _s record; _uid uuid;
begin
  for _s in select * from public.staff_profiles where user_id is null loop
    select id into _uid from auth.users where lower(email) = lower(_s.email) limit 1;
    if _uid is not null then
      update public.staff_profiles set user_id = _uid where id = _s.id;
      insert into public.user_roles (user_id, role) values (_uid, _s.role) on conflict do nothing;
    end if;
  end loop;
end; $$;
revoke execute on function public.link_existing_staff_accounts() from public, anon, authenticated;
select public.link_existing_staff_accounts();

insert into public.shift_slots (weekday, start_time, end_time, role_needed, notes) values
(1,'06:30','14:30','staff','Turno matutino Lunes'),
(1,'14:00','21:00','staff','Turno vespertino Lunes'),
(2,'06:30','14:30','staff','Turno matutino Martes'),
(2,'14:00','21:00','staff','Turno vespertino Martes'),
(3,'06:30','14:30','staff','Turno matutino Miércoles'),
(3,'14:00','21:00','staff','Turno vespertino Miércoles'),
(4,'06:30','14:30','staff','Turno matutino Jueves'),
(4,'14:00','21:00','staff','Turno vespertino Jueves'),
(5,'06:30','14:30','staff','Turno matutino Viernes'),
(5,'14:00','21:00','staff','Turno vespertino Viernes'),
(6,'08:00','15:00','staff','Turno Sábado')
on conflict do nothing;