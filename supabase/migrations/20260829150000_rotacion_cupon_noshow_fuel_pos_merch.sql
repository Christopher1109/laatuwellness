-- ============================================================================
-- FASE 2: rotación de coaches de fin de semana, cupón de referido, no-show
-- fee para membresías, catálogo real de Fuel en el POS, y merch reducido a
-- calcetines.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Rotación de coaches de sábado y domingo
--    Sábados: Moni, Jocelyn, Gloria, Betzy. Domingos: Nancy, Lore, Jocelyn.
--    Rotación semanal round-robin (semana absoluta desde época unix / 7 días),
--    para que sea determinística y no dependa de guardar en qué semana vamos.
-- ----------------------------------------------------------------------------
create table if not exists public.weekend_coach_rotation (
  id uuid primary key default gen_random_uuid(),
  day_of_week smallint not null check (day_of_week in (0, 6)), -- 0=domingo, 6=sábado (extract(dow))
  position int not null check (position > 0),
  coach_id uuid not null references public.staff_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (day_of_week, position)
);
grant select on public.weekend_coach_rotation to authenticated;
grant insert, update, delete on public.weekend_coach_rotation to authenticated;
grant all on public.weekend_coach_rotation to service_role;
alter table public.weekend_coach_rotation enable row level security;

create policy "weekend_rotation_read" on public.weekend_coach_rotation for select to authenticated
  using (public.has_role(auth.uid(), 'admin') or public.is_staff(auth.uid()));
create policy "weekend_rotation_admin_write" on public.weekend_coach_rotation for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

insert into public.weekend_coach_rotation (day_of_week, position, coach_id)
select 6, v.position, sp.id
from (values (1, 'Moni'), (2, 'Jocelyn (Joce)'), (3, 'Gloria'), (4, 'Betzy')) as v(position, full_name)
join public.staff_profiles sp on sp.full_name = v.full_name
where not exists (
  select 1 from public.weekend_coach_rotation r where r.day_of_week = 6 and r.position = v.position
);

insert into public.weekend_coach_rotation (day_of_week, position, coach_id)
select 0, v.position, sp.id
from (values (1, 'Nancy'), (2, 'Lore'), (3, 'Jocelyn (Joce)')) as v(position, full_name)
join public.staff_profiles sp on sp.full_name = v.full_name
where not exists (
  select 1 from public.weekend_coach_rotation r where r.day_of_week = 0 and r.position = v.position
);

-- Devuelve qué coach le toca un sábado o domingo dado. Entre semana regresa
-- vacío (no aplica rotación). Uso previsto: mostrarlo en el panel admin al
-- crear/editar horarios de fin de semana; todavía no auto-asigna coach_id
-- al crear una clase, eso queda como siguiente paso de integración con el
-- formulario de horarios.
create or replace function public.get_weekend_coach(_date date)
returns table (coach_id uuid, coach_name text)
language plpgsql stable security definer set search_path = public as $$
declare
  _dow smallint := extract(dow from _date)::smallint;
  _week_num bigint := (extract(epoch from _date::timestamptz) / 604800)::bigint;
  _total int;
  _pos int;
begin
  if _dow not in (0, 6) then
    return;
  end if;

  select count(*) into _total from public.weekend_coach_rotation where day_of_week = _dow;
  if _total is null or _total = 0 then
    return;
  end if;

  _pos := (_week_num % _total) + 1;

  return query
    select r.coach_id, sp.full_name
    from public.weekend_coach_rotation r
    join public.staff_profiles sp on sp.id = r.coach_id
    where r.day_of_week = _dow and r.position = _pos;
end;
$$;
grant execute on function public.get_weekend_coach(date) to authenticated;

-- ----------------------------------------------------------------------------
-- 2) Cupón de referido — un solo código general reutilizable.
--    NOTA: el código exacto "LAATUAMIGA" y el límite de usos (max_uses = NULL,
--    ilimitado) son un valor por default mío, no una decisión de Christopher.
--    Ambos se pueden cambiar después sin nueva migración, editando la fila
--    en `coupons` desde el SQL editor o una futura pantalla de admin.
-- ----------------------------------------------------------------------------
create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  kind text not null default 'referido' check (kind in ('referido')),
  reward_tokens int not null default 1 check (reward_tokens > 0),
  max_uses int, -- NULL = ilimitado
  times_used int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
grant select on public.coupons to anon, authenticated;
grant insert, update, delete on public.coupons to authenticated;
grant all on public.coupons to service_role;
alter table public.coupons enable row level security;

create policy "coupons_read" on public.coupons for select to anon, authenticated
  using (active or public.has_role(auth.uid(), 'admin'));
create policy "coupons_admin_write" on public.coupons for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

insert into public.coupons (code, kind, reward_tokens, max_uses, active)
select 'LAATUAMIGA', 'referido', 1, null, true
where not exists (select 1 from public.coupons where code = 'LAATUAMIGA');

create table if not exists public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.coupons(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (coupon_id, user_id) -- una persona no puede cobrar el mismo código dos veces
);
grant select on public.coupon_redemptions to authenticated;
grant all on public.coupon_redemptions to service_role;
alter table public.coupon_redemptions enable row level security;

create policy "coupon_redemptions_select_own" on public.coupon_redemptions for select to authenticated
  using (auth.uid() = user_id or public.has_role(auth.uid(), 'admin'));

create or replace function public.redeem_coupon(_code text)
returns int language plpgsql security definer set search_path = public as $$
declare _uid uuid := auth.uid(); _c public.coupons;
begin
  if _uid is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into _c from public.coupons where upper(code) = upper(_code) and active for update;
  if not found then raise exception 'COUPON_NOT_FOUND'; end if;
  if _c.max_uses is not null and _c.times_used >= _c.max_uses then
    raise exception 'COUPON_EXHAUSTED';
  end if;
  if exists (select 1 from public.coupon_redemptions where coupon_id = _c.id and user_id = _uid) then
    raise exception 'COUPON_ALREADY_USED';
  end if;

  insert into public.coupon_redemptions (coupon_id, user_id) values (_c.id, _uid);
  update public.coupons set times_used = times_used + 1 where id = _c.id;
  insert into public.token_ledger (user_id, delta, reason) values (_uid, _c.reward_tokens, 'Cupón: ' || _c.code);

  return _c.reward_tokens;
end; $$;
grant execute on function public.redeem_coupon(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3) No-show fee para membresías ($150 MXN)
--    Escenarios (ya definidos por Christopher):
--    - >=12h antes: se regresa el crédito (comportamiento ya existente, sin
--      cambios).
--    - entre 2h y 12h antes: se consume el crédito, sin fee (comportamiento
--      ya existente, sin cambios).
--    - <2h antes, o no-show: se consume el crédito Y se cobra el fee — pero
--      SOLO si el cliente tiene una membresía activa (no paquetes/créditos
--      sueltos).
--
--    IMPORTANTE — lo que esta migración SÍ y NO hace:
--    SÍ: detecta el escenario correcto y registra el fee pendiente en
--    `membership_fees` con status='pending_charge'.
--    NO: cobra la tarjeta. Eso requiere la integración real de Stripe
--    (guardar método de pago del cliente + Payment Intent off-session), que
--    todavía no existe en el proyecto — la pantalla de compra actual ni
--    siquiera captura tarjeta todavía. En cuanto exista esa integración
--    (punto 9 de la lista original), un job/edge function puede leer las
--    filas 'pending_charge' de aquí y cobrarlas automáticamente sin tener
--    que rediseñar esta parte.
-- ----------------------------------------------------------------------------

-- Proxy de "tiene membresía activa": existe una compra completada de un plan
-- recurrente cuya vigencia (validity_days, default 30) no ha expirado. Es una
-- aproximación razonable mientras no exista un objeto real de suscripción
-- (Stripe) con fecha de renovación.
create or replace function public.has_active_membership(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.transactions t
    join public.token_plans p on p.id = t.plan_id
    where t.user_id = _user_id
      and t.status = 'completed'
      and p.recurring = true
      and t.created_at + make_interval(days => coalesce(p.validity_days, 30)) >= now()
  )
$$;
grant execute on function public.has_active_membership(uuid) to authenticated;

create table if not exists public.membership_fees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete set null,
  amount_cents int not null default 15000 check (amount_cents >= 0),
  reason text not null default '',
  status text not null default 'pending_charge' check (status in ('pending_charge', 'charged', 'waived')),
  created_by uuid,
  created_at timestamptz not null default now(),
  charged_at timestamptz
);
grant select on public.membership_fees to authenticated;
grant insert, update on public.membership_fees to authenticated;
grant all on public.membership_fees to service_role;
alter table public.membership_fees enable row level security;

create policy "membership_fees_select" on public.membership_fees for select to authenticated
  using (auth.uid() = user_id or public.has_role(auth.uid(), 'admin') or public.is_staff(auth.uid()));
create policy "membership_fees_admin_write" on public.membership_fees for all to authenticated
  using (public.has_role(auth.uid(), 'admin') or public.is_staff(auth.uid()))
  with check (public.has_role(auth.uid(), 'admin') or public.is_staff(auth.uid()));

-- cancel_booking: agrega el fee de <2h a la lógica de reembolso que ya existía.
create or replace function public.cancel_booking(_booking_id uuid)
returns public.bookings language plpgsql security definer set search_path = public as $$
declare
  _uid uuid := auth.uid();
  _b public.bookings;
  _c public.classes;
  _hours_left numeric;
begin
  if _uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into _b from public.bookings where id = _booking_id;
  if not found then raise exception 'BOOKING_NOT_FOUND'; end if;
  if _b.user_id <> _uid and not public.has_role(_uid, 'admin') then raise exception 'FORBIDDEN'; end if;
  if _b.status <> 'reservada' then raise exception 'ALREADY_CANCELLED'; end if;
  select * into _c from public.classes where id = _b.class_id;

  update public.bookings set status = 'cancelada' where id = _booking_id returning * into _b;

  _hours_left := extract(epoch from (_c.starts_at - now())) / 3600.0;

  if _hours_left >= 12 then
    insert into public.token_ledger (user_id, delta, reason)
      values (_b.user_id, _b.tokens_spent, 'Cancelación con reembolso');
  elsif _hours_left < 2 and public.has_active_membership(_b.user_id) then
    insert into public.membership_fees (user_id, booking_id, amount_cents, reason)
      values (_b.user_id, _b.id, 15000, 'Cancelación con menos de 2 horas de anticipación');
  end if;

  return _b;
end; $$;

-- mark_no_show: el monto real del fee ya NO depende de lo que mande el
-- frontend (hoy siempre manda 0) — se fija aquí en $150 MXN por regla de
-- negocio, y solo aplica si el cliente tiene membresía activa. `_penalty_cents`
-- se conserva en la firma por compatibilidad, pero se ignora para el monto.
create or replace function public.mark_no_show(_booking_id uuid, _penalty_cents int default 15000)
returns public.check_ins language plpgsql security definer set search_path = public as $$
declare
  _row public.check_ins;
  _b public.bookings;
begin
  if not (public.is_staff(auth.uid()) or public.has_role(auth.uid(), 'admin')) then
    raise exception 'FORBIDDEN';
  end if;

  insert into public.check_ins (booking_id, checked_in_by, status)
    values (_booking_id, auth.uid(), 'no_show')
    on conflict (booking_id) do update set status = 'no_show', checked_in_by = auth.uid()
    returning * into _row;

  select * into _b from public.bookings where id = _booking_id;
  if _b.id is not null
     and public.has_active_membership(_b.user_id)
     and not exists (select 1 from public.membership_fees where booking_id = _b.id) then
    insert into public.membership_fees (user_id, booking_id, amount_cents, reason, created_by)
      values (_b.user_id, _b.id, 15000, 'No-show', auth.uid());
  end if;

  return _row;
end; $$;
revoke execute on function public.mark_no_show(uuid, int) from public, anon;
grant execute on function public.mark_no_show(uuid, int) to authenticated;

-- ----------------------------------------------------------------------------
-- 4) Catálogo real de Fuel en el punto de venta (antes eran placeholders
--    genéricos: barrita/smoothie/shot de proteína, café de especialidad).
--    Los add-ons de jarabe se agrupan en un solo producto porque el precio
--    es el mismo sin importar el sabor.
-- ----------------------------------------------------------------------------
update public.products set active = false
where sku in ('REC-BAR-01', 'REC-SMO-01', 'REC-PRO-01', 'REC-CAF-01');

insert into public.products (name, sku, category, price_cents, cost_cents, stock, low_stock_threshold, active)
select v.name, v.sku, 'consumible', v.price_cents, v.cost_cents, 999, 10, true
from (values
  ('Smoothie Blush', 'FUEL-SMO-BLUSH', 12500, 7500),
  ('Smoothie Indigo', 'FUEL-SMO-INDIGO', 12500, 7500),
  ('Smoothie Lift', 'FUEL-SMO-LIFT', 12500, 7500),
  ('Smoothie Verde', 'FUEL-SMO-VERDE', 12500, 7500),
  ('Latte', 'FUEL-COF-LATTE', 10500, 6300),
  ('Capu', 'FUEL-COF-CAPU', 8000, 4800),
  ('Flat', 'FUEL-COF-FLAT', 9000, 5400),
  ('Brew', 'FUEL-COF-BREW', 10500, 6300),
  ('Matcha', 'FUEL-COF-MATCHA', 10500, 6300),
  ('Add-on: Proteína whey Easy Fit', 'FUEL-ADD-WHEY', 3500, 2000),
  ('Add-on: Proteína vegetal Habits', 'FUEL-ADD-VEGAN', 3500, 2000),
  ('Add-on: Colágeno', 'FUEL-ADD-COLAGENO', 3000, 1700),
  ('Add-on: Jarabe', 'FUEL-ADD-JARABE', 1500, 800)
) as v(name, sku, price_cents, cost_cents)
where not exists (select 1 from public.products p where p.sku = v.sku);

-- ----------------------------------------------------------------------------
-- 5) Merch simplificado a solo calcetines ("Calcetines de grip" ya existía
--    en el catálogo). Se desactivan los demás, no se borran, para no perder
--    historial de ventas/inventario ya ligado a esos product_id.
-- ----------------------------------------------------------------------------
update public.products set active = false
where category = 'merch'
  and sku not in ('MER-CAL-01');
