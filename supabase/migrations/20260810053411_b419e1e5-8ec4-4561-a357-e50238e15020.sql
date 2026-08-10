-- ROLES
create type public.app_role as enum ('admin','user');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null default '',
  phone text,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create policy "profiles_select_own" on public.profiles for select to authenticated
  using (auth.uid() = id or public.has_role(auth.uid(),'admin'));
create policy "profiles_insert_own" on public.profiles for insert to authenticated
  with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update to authenticated
  using (auth.uid() = id or public.has_role(auth.uid(),'admin'))
  with check (auth.uid() = id or public.has_role(auth.uid(),'admin'));

create policy "user_roles_select_own" on public.user_roles for select to authenticated
  using (auth.uid() = user_id or public.has_role(auth.uid(),'admin'));

-- auto profile
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email, phone)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''), coalesce(new.email,''), new.raw_user_meta_data->>'phone')
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role) values (new.id, 'user') on conflict do nothing;
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- PLANS
create table public.token_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  tokens int not null check (tokens > 0),
  price_cents int not null check (price_cents >= 0),
  currency text not null default 'MXN',
  recurring boolean not null default false,
  validity_days int,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
grant select on public.token_plans to anon, authenticated;
grant insert, update, delete on public.token_plans to authenticated;
grant all on public.token_plans to service_role;
alter table public.token_plans enable row level security;
create policy "plans_public_read" on public.token_plans for select to anon, authenticated using (active or public.has_role(auth.uid(),'admin'));
create policy "plans_admin_write" on public.token_plans for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- TRANSACTIONS
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid references public.token_plans(id) on delete set null,
  amount_cents int not null default 0,
  tokens int not null default 0,
  currency text not null default 'MXN',
  payment_method text not null default 'pendiente',
  status text not null default 'pending',
  created_at timestamptz not null default now()
);
grant select, insert on public.transactions to authenticated;
grant all on public.transactions to service_role;
alter table public.transactions enable row level security;
create policy "tx_select_own" on public.transactions for select to authenticated
  using (auth.uid() = user_id or public.has_role(auth.uid(),'admin'));
create policy "tx_insert_own" on public.transactions for insert to authenticated
  with check (auth.uid() = user_id);
create policy "tx_admin_update" on public.transactions for update to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- TOKEN LEDGER
create table public.token_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  delta int not null,
  reason text not null default '',
  transaction_id uuid references public.transactions(id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index token_ledger_user_idx on public.token_ledger(user_id);
grant select on public.token_ledger to authenticated;
grant all on public.token_ledger to service_role;
alter table public.token_ledger enable row level security;
create policy "ledger_select_own" on public.token_ledger for select to authenticated
  using (auth.uid() = user_id or public.has_role(auth.uid(),'admin'));

create or replace function public.token_balance(_user_id uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(delta),0)::int from public.token_ledger where user_id = _user_id
$$;

-- WAIVER
create table public.waiver_signatures (
  user_id uuid primary key references auth.users(id) on delete cascade,
  signed_at timestamptz not null default now(),
  signature_data text not null,
  full_name text not null default ''
);
grant select, insert on public.waiver_signatures to authenticated;
grant all on public.waiver_signatures to service_role;
alter table public.waiver_signatures enable row level security;
create policy "waiver_select_own" on public.waiver_signatures for select to authenticated
  using (auth.uid() = user_id or public.has_role(auth.uid(),'admin'));
create policy "waiver_insert_own" on public.waiver_signatures for insert to authenticated
  with check (auth.uid() = user_id);

-- CLASSES
create table public.classes (
  id uuid primary key default gen_random_uuid(),
  room text not null default 'Reformer',
  instructor text not null default '',
  starts_at timestamptz not null,
  duration_min int not null default 50,
  capacity int not null default 10,
  tokens_cost int not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index classes_starts_idx on public.classes(starts_at);
grant select on public.classes to anon, authenticated;
grant insert, update, delete on public.classes to authenticated;
grant all on public.classes to service_role;
alter table public.classes enable row level security;
create policy "classes_public_read" on public.classes for select to anon, authenticated
  using (active or public.has_role(auth.uid(),'admin'));
create policy "classes_admin_write" on public.classes for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- BOOKINGS
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  tokens_spent int not null default 1,
  status text not null default 'reservada',
  created_at timestamptz not null default now(),
  unique (user_id, class_id)
);
create index bookings_class_idx on public.bookings(class_id);
grant select on public.bookings to authenticated;
grant all on public.bookings to service_role;
alter table public.bookings enable row level security;
create policy "bookings_select_own" on public.bookings for select to authenticated
  using (auth.uid() = user_id or public.has_role(auth.uid(),'admin'));

create or replace function public.class_seats_taken(_class_id uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.bookings where class_id = _class_id and status = 'reservada'
$$;
grant execute on function public.class_seats_taken(uuid) to anon, authenticated;

create or replace function public.book_class(_class_id uuid)
returns public.bookings language plpgsql security definer set search_path = public as $$
declare _uid uuid := auth.uid(); _c public.classes; _b public.bookings; _taken int; _bal int;
begin
  if _uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into _c from public.classes where id = _class_id and active;
  if not found then raise exception 'CLASS_NOT_FOUND'; end if;
  if _c.starts_at <= now() then raise exception 'CLASS_PAST'; end if;
  if not exists (select 1 from public.waiver_signatures where user_id = _uid) then raise exception 'WAIVER_REQUIRED'; end if;
  select count(*) into _taken from public.bookings where class_id = _class_id and status = 'reservada';
  if _taken >= _c.capacity then raise exception 'CLASS_FULL'; end if;
  if exists (select 1 from public.bookings where class_id = _class_id and user_id = _uid and status = 'reservada') then raise exception 'ALREADY_BOOKED'; end if;
  select public.token_balance(_uid) into _bal;
  if _bal < _c.tokens_cost then raise exception 'INSUFFICIENT_TOKENS'; end if;
  insert into public.bookings (user_id, class_id, tokens_spent) values (_uid, _class_id, _c.tokens_cost)
    on conflict (user_id, class_id) do update set status = 'reservada', tokens_spent = _c.tokens_cost
    returning * into _b;
  insert into public.token_ledger (user_id, delta, reason) values (_uid, -_c.tokens_cost, 'Reserva de clase');
  return _b;
end; $$;
grant execute on function public.book_class(uuid) to authenticated;

create or replace function public.cancel_booking(_booking_id uuid)
returns public.bookings language plpgsql security definer set search_path = public as $$
declare _uid uuid := auth.uid(); _b public.bookings; _c public.classes;
begin
  if _uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into _b from public.bookings where id = _booking_id;
  if not found then raise exception 'BOOKING_NOT_FOUND'; end if;
  if _b.user_id <> _uid and not public.has_role(_uid,'admin') then raise exception 'FORBIDDEN'; end if;
  if _b.status <> 'reservada' then raise exception 'ALREADY_CANCELLED'; end if;
  select * into _c from public.classes where id = _b.class_id;
  update public.bookings set status = 'cancelada' where id = _booking_id returning * into _b;
  if _c.starts_at - now() > interval '12 hours' then
    insert into public.token_ledger (user_id, delta, reason) values (_b.user_id, _b.tokens_spent, 'Cancelación con reembolso');
  end if;
  return _b;
end; $$;
grant execute on function public.cancel_booking(uuid) to authenticated;

create or replace function public.admin_adjust_tokens(_user_id uuid, _delta int, _reason text)
returns int language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(),'admin') then raise exception 'FORBIDDEN'; end if;
  insert into public.token_ledger (user_id, delta, reason, created_by) values (_user_id, _delta, coalesce(_reason,'Ajuste manual'), auth.uid());
  return public.token_balance(_user_id);
end; $$;
grant execute on function public.admin_adjust_tokens(uuid, int, text) to authenticated;

create or replace function public.purchase_plan(_plan_id uuid, _payment_method text)
returns uuid language plpgsql security definer set search_path = public as $$
declare _uid uuid := auth.uid(); _p public.token_plans; _tx uuid;
begin
  if _uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into _p from public.token_plans where id = _plan_id and active;
  if not found then raise exception 'PLAN_NOT_FOUND'; end if;
  insert into public.transactions (user_id, plan_id, amount_cents, tokens, currency, payment_method, status)
    values (_uid, _p.id, _p.price_cents, _p.tokens, _p.currency, coalesce(_payment_method,'pendiente'), 'completed')
    returning id into _tx;
  insert into public.token_ledger (user_id, delta, reason, transaction_id)
    values (_uid, _p.tokens, 'Compra: ' || _p.name, _tx);
  return _tx;
end; $$;
grant execute on function public.purchase_plan(uuid, text) to authenticated;

-- COACHES
create table public.coaches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  specialty text not null default '',
  bio text not null default '',
  image_url text,
  active boolean not null default true,
  sort_order int not null default 0
);
grant select on public.coaches to anon, authenticated;
grant insert, update, delete on public.coaches to authenticated;
grant all on public.coaches to service_role;
alter table public.coaches enable row level security;
create policy "coaches_public_read" on public.coaches for select to anon, authenticated using (active or public.has_role(auth.uid(),'admin'));
create policy "coaches_admin_write" on public.coaches for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- MODULES
create table public.site_modules (
  key text primary key,
  name text not null,
  description text not null default '',
  category text not null default 'servicio',
  enabled boolean not null default true,
  sort_order int not null default 0
);
grant select on public.site_modules to anon, authenticated;
grant insert, update, delete on public.site_modules to authenticated;
grant all on public.site_modules to service_role;
alter table public.site_modules enable row level security;
create policy "modules_public_read" on public.site_modules for select to anon, authenticated using (true);
create policy "modules_admin_write" on public.site_modules for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- LEADS
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text,
  message text not null default '',
  created_at timestamptz not null default now()
);
grant insert on public.leads to anon, authenticated;
grant select on public.leads to authenticated;
grant all on public.leads to service_role;
alter table public.leads enable row level security;
create policy "leads_public_insert" on public.leads for insert to anon, authenticated with check (true);
create policy "leads_admin_read" on public.leads for select to authenticated using (public.has_role(auth.uid(),'admin'));

-- SEED
insert into public.site_modules (key, name, description, category, enabled, sort_order) values
('reformer','Reformer Studio','Salón íntimo de máximo 10 personas. Trabajo de fuerza, control y movilidad sobre reformer.','salon',true,1),
('salon-2','Segundo Salón','Nombre por definir. Espacio complementario para movimiento y respiración.','salon',false,2),
('contraste','Contrast Therapy','Sauna infrarrojo y agua fría. Recuperación por contraste para bajar inflamación y regular el sistema nervioso.','servicio',true,3),
('nutricion','Nutrition','Acompañamiento nutricional enfocado en longevidad y energía sostenida.','servicio',true,4),
('psicologia','Psychology','Sesiones de psicología para sostener el proceso desde adentro.','servicio',true,5);

insert into public.coaches (name, specialty, bio, active, sort_order) values
('Ana Ruiz','Reformer / Mat','Guía el trabajo de fuerza con precisión y calma. Cree que el control es una forma de descanso.',true,1),
('Sofía Lara','Reformer / Movilidad','Le interesa el rango, no el rendimiento. Sus clases abren espacio en el cuerpo.',true,2),
('Renata Vidal','Contrast Therapy','Acompaña la recuperación y la respiración. Traduce el frío en claridad.',true,3),
('Camila Ortiz','Reformer / Pre y Postnatal','Trabaja el proceso a su ritmo. Sin prisa, sin comparación.',true,4);

insert into public.token_plans (name, description, tokens, price_cents, recurring, validity_days, active, sort_order) values
('Drop In','Una clase para probar el espacio.',1,45000,false,30,true,1),
('Pack 10','Diez clases para sostener el hábito.',10,380000,false,90,true,2),
('Membresía Mensual','Doce clases al mes, cargo recurrente. Cupo limitado a 30 personas.',12,420000,true,30,true,3);

insert into public.classes (room, instructor, starts_at, duration_min, capacity)
select 'Reformer',
  (array['Ana Ruiz','Sofía Lara','Camila Ortiz'])[1 + (n % 3)],
  date_trunc('day', now()) + make_interval(days => (n / 3) + 1, hours => 7 + (n % 3) * 4),
  50, 10
from generate_series(0, 20) as n;