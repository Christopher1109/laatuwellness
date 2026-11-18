-- Founders: 3 opciones de renovación, pago de multas en recepción, congelar
-- membresía, recordatorios por correo 10 días antes y arreglos a la
-- renovación automática con tarjeta.

-- 1. Condonar usa el estado válido 'waived' (antes 'condonada' violaba el CHECK).
create or replace function public.waive_membership_fee(_fee_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'FORBIDDEN'; end if;
  update public.membership_fees set status = 'waived'
   where id = _fee_id and status = 'pending_charge';
  if not found then raise exception 'NOT_FOUND'; end if;
end; $$;

create or replace function public.waive_no_show(_no_show_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare _ns public.no_shows;
begin
  if not (public.is_staff(auth.uid()) or public.has_role(auth.uid(), 'admin')) then
    raise exception 'FORBIDDEN';
  end if;
  update public.no_shows set waived = true, waived_by = auth.uid(), waived_at = now()
   where id = _no_show_id and not waived returning * into _ns;
  if not found then raise exception 'NOT_FOUND'; end if;
  if _ns.fee_id is not null then
    update public.membership_fees set status = 'waived'
     where id = _ns.fee_id and status = 'pending_charge';
  end if;
end; $$;

-- 2. Cargos: tipo (multa / renovación), plan a renovar y forma de pago.
alter table public.membership_fees
  add column if not exists kind text not null default 'multa',
  add column if not exists renewal_plan_id uuid references public.token_plans(id),
  add column if not exists cycle_end timestamptz,
  add column if not exists paid_method text;
-- Una renovación fallida deja un solo cargo pendiente por ciclo (sin duplicados).
create unique index if not exists membership_fees_one_pending_renewal
  on public.membership_fees (user_id, cycle_end)
  where kind = 'renovacion' and status = 'pending_charge';

-- 3. Tarjeta: plan que la clienta eligió renovar automáticamente y entorno de Stripe.
alter table public.saved_cards
  add column if not exists renewal_plan_id uuid references public.token_plans(id),
  add column if not exists stripe_env text not null default 'live';

-- 4. Planes con vigencia en meses de calendario (cobro el mismo día cada mes).
alter table public.token_plans add column if not exists validity_months integer;

create or replace function public.membership_end_months(_start timestamptz, _months integer)
returns timestamptz language sql immutable set search_path to 'public' as $$
  select ((((_start at time zone 'America/Monterrey')::date + make_interval(months => _months))::date - 1)
          + time '23:59:59') at time zone 'America/Monterrey'
$$;

insert into public.token_plans
  (name, description, tokens, price_cents, currency, recurring, validity_days, validity_months, active,
   sort_order, category, subtitle, includes, excludes, terms, stripe_price_id, daily_class_limit,
   renews_plan_id, credit_kind, no_show_penalty)
select 'Founders Access · Mensual recurrente',
       'Renovación mensual exclusiva para miembros Founders Access, con cargo automático a tarjeta.',
       0, 429900, 'MXN', false, 30, 1, true, 3, 'membresia', '1 clase por día · cargo automático mensual',
       p.includes, p.excludes,
       'Cargo automático a la tarjeta registrada el día 2 de cada mes. Puedes desactivar la renovación desde tu perfil. Uso personal e intransferible. Las clases no son acumulables.',
       '', 1, p.id, p.credit_kind, true
  from public.token_plans p
 where p.id = 'b4302499-2791-4d01-bde8-345ccfc0d59d'
   and not exists (select 1 from public.token_plans where name = 'Founders Access · Mensual recurrente');

-- 5. La nueva vigencia de cualquier membresía empieza donde termina la actual
--    (p. ej. Founders → The Everyday comprada antes del vencimiento).
create or replace function public.trg_set_membership_access()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare _p public.token_plans; _prev timestamptz; _start timestamptz;
begin
  if NEW.plan_id is null or NEW.status <> 'completed' or NEW.access_ends_at is not null then return NEW; end if;
  select * into _p from public.token_plans where id = NEW.plan_id;
  if not found or _p.daily_class_limit is null then return NEW; end if;
  select max(t.access_ends_at) into _prev
    from public.transactions t join public.token_plans p on p.id = t.plan_id
   where t.user_id = NEW.user_id and t.status = 'completed' and p.daily_class_limit is not null;
  if _prev is not null and _prev > now() - interval '1 day' then
    _start := _prev + interval '1 second';
  else
    _start := public.purchase_validity_start(coalesce(NEW.created_at, now()), _p.membership_starts_at);
  end if;
  NEW.access_starts_at := _start;
  NEW.access_ends_at := case
    when _p.validity_months is not null then public.membership_end_months(_start, _p.validity_months)
    else public.membership_end(_start, coalesce(_p.validity_days, 30)) end;
  return NEW;
end; $$;

-- 6. Las renovaciones de Founders se pueden comprar desde 15 días antes.
create or replace function public.plan_purchase_block_reason(_user_id uuid, _plan_id uuid)
returns text language plpgsql stable security definer set search_path to 'public' as $$
declare _p public.token_plans; _latest timestamptz;
begin
  if auth.uid() is not null and auth.uid() <> _user_id
     and not (public.has_role(auth.uid(), 'admin') or public.is_staff(auth.uid())) then
    raise exception 'FORBIDDEN';
  end if;
  select * into _p from public.token_plans where id = _plan_id;
  if not found or not _p.active or _p.welcome_gift then return 'PLAN_NOT_AVAILABLE'; end if;
  if _p.renews_plan_id is not null then
    select max(t.access_ends_at) into _latest from public.transactions t
     where t.user_id = _user_id and t.status = 'completed'
       and t.plan_id in (select id from public.token_plans where id = _p.renews_plan_id or renews_plan_id = _p.renews_plan_id);
    if _latest is null then return 'RENEWAL_NOT_ELIGIBLE'; end if;
    if _latest < now() then return 'RENEWAL_EXPIRED'; end if;
    if _latest > now() + interval '15 days' then return 'RENEWAL_TOO_EARLY'; end if;
    return null;
  end if;
  if _p.available_from is not null and now() < _p.available_from then return 'PLAN_NOT_YET_AVAILABLE'; end if;
  if _p.available_until is not null and now() > _p.available_until then return 'PLAN_EXPIRED'; end if;
  if _p.max_sales is not null and public.plan_sales_count(_plan_id) >= _p.max_sales then return 'PLAN_SOLD_OUT'; end if;
  if _p.purchasable_once and exists (
    select 1 from public.transactions where user_id = _user_id and plan_id = _plan_id and status = 'completed'
  ) then return 'PLAN_ALREADY_PURCHASED'; end if;
  if _p.new_clients_only and public.has_paid_purchase(_user_id) then return 'NEW_CLIENTS_ONLY'; end if;
  return null;
end; $$;

-- 7. Renovaciones con tarjeta: solo el plan que la clienta eligió (Founders
--    mensual). Las membresías con suscripción de Stripe no se cobran aquí para
--    no duplicar el cargo. Se cobra el último día del periodo (día 2) y nunca
--    si ya hay un cargo pendiente de esa renovación.
drop function if exists public.due_renewals();
create function public.due_renewals()
returns table(user_id uuid, plan_id uuid, renewal_plan_id uuid, plan_name text, amount_cents integer,
              customer_id text, payment_method_id text, ends_at timestamptz, stripe_env text)
language plpgsql security definer set search_path to 'public' as $$
begin
  return query
  with latest as (
    select distinct on (t.user_id) t.user_id, t.plan_id, t.access_ends_at
      from public.transactions t join public.token_plans p on p.id = t.plan_id
     where t.status = 'completed' and p.daily_class_limit is not null and t.access_ends_at is not null
     order by t.user_id, t.access_ends_at desc
  )
  select l.user_id, l.plan_id, r.id, r.name, r.price_cents, sc.customer_id, sc.payment_method_id,
         l.access_ends_at, sc.stripe_env
    from latest l
    join public.saved_cards sc on sc.user_id = l.user_id and sc.auto_renew and sc.renewal_plan_id is not null
    join public.token_plans r on r.id = sc.renewal_plan_id and r.active and r.validity_months is not null
   where (l.plan_id = r.id or l.plan_id = r.renews_plan_id)
     and (l.access_ends_at at time zone 'America/Monterrey')::date <= (now() at time zone 'America/Monterrey')::date
     and not exists (
       select 1 from public.membership_fees f
        where f.user_id = l.user_id and f.kind = 'renovacion' and f.cycle_end = l.access_ends_at
          and f.status in ('pending_charge', 'charged')
     );
end; $$;
revoke all on function public.due_renewals() from public, anon, authenticated;

-- 8. Estado de renovación para la app (pop-up Founders y genérico).
create or replace function public.renewal_status(_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  _founders constant uuid := 'b4302499-2791-4d01-bde8-345ccfc0d59d';
  _l record; _card public.saved_cards; _opt boolean; _days int; _is_founders boolean;
  _monthly record; _semestral record; _everyday record; _chosen text;
begin
  if auth.uid() is null or (auth.uid() <> _user_id and not (public.has_role(auth.uid(), 'admin') or public.is_staff(auth.uid()))) then
    raise exception 'FORBIDDEN';
  end if;
  select t.access_ends_at, p.id as plan_id, p.name, p.recurring, coalesce(p.renews_plan_id, p.id) as family
    into _l from public.transactions t join public.token_plans p on p.id = t.plan_id
   where t.user_id = _user_id and t.status = 'completed' and p.daily_class_limit is not null and t.access_ends_at is not null
   order by t.access_ends_at desc limit 1;
  if not found then return null; end if;

  select * into _card from public.saved_cards where user_id = _user_id;
  select exists (select 1 from public.renewal_opt_outs where user_id = _user_id and cycle_end = _l.access_ends_at) into _opt;
  _days := greatest(0, ceil(extract(epoch from (_l.access_ends_at - now())) / 86400.0))::int;
  _is_founders := _l.family = _founders;

  select id, name, price_cents into _monthly from public.token_plans
   where renews_plan_id = _founders and validity_months is not null and active order by sort_order limit 1;
  select id, name, price_cents into _semestral from public.token_plans
   where renews_plan_id = _founders and validity_months is null and active order by sort_order limit 1;
  select id, name, price_cents into _everyday from public.token_plans where name = 'The Everyday' and active limit 1;

  _chosen := case when _card.user_id is not null and _card.auto_renew and _card.renewal_plan_id is not null
                  then (select name from public.token_plans where id = _card.renewal_plan_id) end;

  return jsonb_build_object(
    'plan_name', _l.name,
    'ends_at', _l.access_ends_at,
    'days_left', _days,
    'has_card', _card.user_id is not null,
    'auto_renew', coalesce(_card.auto_renew, false),
    'card_brand', coalesce(_card.brand, ''),
    'card_last4', coalesce(_card.last4, ''),
    'renewal_plan_name', _chosen,
    'opted_out', _opt,
    'is_founders', _is_founders,
    'founders_options', case when _is_founders then jsonb_build_object(
        'monthly', jsonb_build_object('id', _monthly.id, 'name', _monthly.name, 'price_cents', _monthly.price_cents),
        'semestral', jsonb_build_object('id', _semestral.id, 'name', _semestral.name, 'price_cents', _semestral.price_cents),
        'everyday', jsonb_build_object('id', _everyday.id, 'name', _everyday.name, 'price_cents', _everyday.price_cents)
      ) end,
    'show_founders_modal', (_is_founders and _l.access_ends_at > now() and _days <= 15
                            and _chosen is null and not _opt),
    'show_modal', (not _is_founders and not _l.recurring and _l.access_ends_at > now() and _days <= 10
                   and _chosen is null and not _opt)
  );
end; $$;

-- "No quiero renovar" aplica a cualquier membresía (no solo con multa).
create or replace function public.opt_out_renewal()
returns void language plpgsql security definer set search_path to 'public' as $$
declare _ends timestamptz;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select max(t.access_ends_at) into _ends
    from public.transactions t join public.token_plans p on p.id = t.plan_id
   where t.user_id = auth.uid() and t.status = 'completed' and p.daily_class_limit is not null
     and t.access_ends_at > now();
  if _ends is null then raise exception 'NOT_FOUND'; end if;
  insert into public.renewal_opt_outs (user_id, cycle_end) values (auth.uid(), _ends)
    on conflict (user_id, cycle_end) do nothing;
end; $$;

-- membership_status: botón de renovar desde 15 días antes, eligiendo el
-- primer plan de renovación por orden.
create or replace function public.membership_status(_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare _t record; _used int; _renew record; _latest timestamptz; _upcoming boolean := false;
begin
  if auth.uid() is null or (auth.uid() <> _user_id and not (public.has_role(auth.uid(), 'admin') or public.is_staff(auth.uid()))) then
    raise exception 'FORBIDDEN';
  end if;
  select t.access_starts_at, t.access_ends_at, p.id as plan_id, p.name, p.daily_class_limit, coalesce(p.renews_plan_id, p.id) as family
    into _t from public.transactions t join public.token_plans p on p.id = t.plan_id
   where t.user_id = _user_id and t.status = 'completed' and p.daily_class_limit is not null
     and now() between t.access_starts_at and t.access_ends_at
   order by t.access_ends_at desc limit 1;
  if not found then
    select t.access_starts_at, t.access_ends_at, p.id as plan_id, p.name, p.daily_class_limit, coalesce(p.renews_plan_id, p.id) as family
      into _t from public.transactions t join public.token_plans p on p.id = t.plan_id
     where t.user_id = _user_id and t.status = 'completed' and p.daily_class_limit is not null
       and t.access_starts_at > now()
     order by t.access_starts_at asc limit 1;
    if not found then return null; end if;
    _upcoming := true;
  end if;
  select count(*) into _used from public.bookings b join public.classes c on c.id = b.class_id
   where b.user_id = _user_id and b.status = 'reservada' and b.tokens_spent = 0
     and (c.starts_at at time zone 'America/Monterrey')::date = (now() at time zone 'America/Monterrey')::date;
  select max(t.access_ends_at) into _latest from public.transactions t join public.token_plans p on p.id = t.plan_id
   where t.user_id = _user_id and t.status = 'completed' and p.daily_class_limit is not null;
  select id, name, price_cents into _renew from public.token_plans
   where renews_plan_id = _t.family and active and validity_months is null order by sort_order limit 1;
  return jsonb_build_object(
    'plan_id', _t.plan_id, 'plan_name', _t.name, 'daily_limit', _t.daily_class_limit,
    'starts_at', _t.access_starts_at, 'upcoming', _upcoming,
    'ends_at', _latest, 'used_today', case when _upcoming then 0 else _used end,
    'renewal_plan_id', case when not _upcoming and _renew.id is not null and _latest <= now() + interval '15 days' then _renew.id end,
    'renewal_plan_name', _renew.name, 'renewal_price_cents', _renew.price_cents);
end; $$;

-- 9. Multa o renovación pagada en recepción (staff). Si es renovación, se
--    activa el nuevo periodo.
create or replace function public.mark_fee_paid_at_reception(_fee_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare _f public.membership_fees;
begin
  if not (public.is_staff(auth.uid()) or public.has_role(auth.uid(), 'admin')) then
    raise exception 'FORBIDDEN';
  end if;
  update public.membership_fees
     set status = 'charged', charged_at = now(), paid_method = 'recepcion'
   where id = _fee_id and status = 'pending_charge'
   returning * into _f;
  if not found then raise exception 'NOT_FOUND'; end if;
  if _f.kind = 'renovacion' and _f.renewal_plan_id is not null then
    perform public.fulfill_plan_purchase(_f.user_id, _f.renewal_plan_id, 'fee_' || _f.id, 'recepción');
  end if;
end; $$;
grant execute on function public.mark_fee_paid_at_reception(uuid) to authenticated;

-- 10. Congelar membresía (lo hace el staff a petición de la clienta), máximo
--     14 días en los últimos 365.
create table if not exists public.membership_freezes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  transaction_id uuid not null references public.transactions(id),
  days integer not null check (days between 1 and 14),
  created_by uuid,
  created_at timestamptz not null default now()
);
grant select on public.membership_freezes to authenticated;
grant all on public.membership_freezes to service_role;
alter table public.membership_freezes enable row level security;
drop policy if exists "staff read freezes" on public.membership_freezes;
create policy "staff read freezes" on public.membership_freezes for select to authenticated
  using (auth.uid() = user_id or public.is_staff(auth.uid()) or public.has_role(auth.uid(), 'admin'));

create or replace function public.freeze_membership(_user_id uuid, _days integer)
returns timestamptz language plpgsql security definer set search_path to 'public' as $$
declare _tx record; _used int; _new_end timestamptz;
begin
  if not (public.is_staff(auth.uid()) or public.has_role(auth.uid(), 'admin')) then
    raise exception 'FORBIDDEN';
  end if;
  if _days is null or _days < 1 then raise exception 'INVALID_DAYS'; end if;
  select coalesce(sum(days), 0) into _used from public.membership_freezes
   where user_id = _user_id and created_at > now() - interval '365 days';
  if _used + _days > 14 then raise exception 'FREEZE_LIMIT'; end if;
  select t.id, t.access_ends_at into _tx
    from public.transactions t join public.token_plans p on p.id = t.plan_id
   where t.user_id = _user_id and t.status = 'completed' and p.daily_class_limit is not null
     and t.access_ends_at > now()
   order by t.access_ends_at desc limit 1;
  if not found then raise exception 'NO_ACTIVE_MEMBERSHIP'; end if;
  update public.transactions set access_ends_at = access_ends_at + make_interval(days => _days)
   where id = _tx.id returning access_ends_at into _new_end;
  insert into public.membership_freezes (user_id, transaction_id, days, created_by)
    values (_user_id, _tx.id, _days, auth.uid());
  return _new_end;
end; $$;
grant execute on function public.freeze_membership(uuid, integer) to authenticated;

-- 11. Recordatorios por correo 10 días antes del vencimiento.
create table if not exists public.membership_reminders (
  user_id uuid not null,
  cycle_end timestamptz not null,
  template text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, cycle_end)
);
grant all on public.membership_reminders to service_role;
alter table public.membership_reminders enable row level security;
drop policy if exists "staff read reminders" on public.membership_reminders;
create policy "staff read reminders" on public.membership_reminders for select to authenticated
  using (public.is_staff(auth.uid()) or public.has_role(auth.uid(), 'admin'));

create or replace function public.due_membership_reminders()
returns table(user_id uuid, email text, full_name text, plan_name text, ends_at timestamptz,
              is_founders boolean, auto_renew_plan text)
language plpgsql security definer set search_path to 'public' as $$
begin
  return query
  with latest as (
    select distinct on (t.user_id) t.user_id, t.access_ends_at, p.name, coalesce(p.renews_plan_id, p.id) as family
      from public.transactions t join public.token_plans p on p.id = t.plan_id
     where t.status = 'completed' and p.daily_class_limit is not null and t.access_ends_at is not null
     order by t.user_id, t.access_ends_at desc
  )
  select l.user_id, pr.email, pr.full_name, l.name, l.access_ends_at,
         l.family = 'b4302499-2791-4d01-bde8-345ccfc0d59d'::uuid,
         (select r.name from public.saved_cards sc join public.token_plans r on r.id = sc.renewal_plan_id
           where sc.user_id = l.user_id and sc.auto_renew)
    from latest l join public.profiles pr on pr.id = l.user_id
   where pr.email is not null and pr.email <> ''
     and l.access_ends_at > now()
     and (l.access_ends_at at time zone 'America/Monterrey')::date
         <= (now() at time zone 'America/Monterrey')::date + 10
     and not exists (select 1 from public.membership_reminders m
                      where m.user_id = l.user_id and m.cycle_end = l.access_ends_at);
end; $$;
revoke all on function public.due_membership_reminders() from public, anon, authenticated;

-- 12. Secreto para las tareas programadas (pg_cron → rutas /api/public/*).
create table if not exists public.cron_secrets (
  name text primary key,
  secret text not null default encode(gen_random_bytes(32), 'hex')
);
revoke all on public.cron_secrets from public, anon, authenticated;
grant all on public.cron_secrets to service_role;
alter table public.cron_secrets enable row level security;
insert into public.cron_secrets (name) values ('scheduled_jobs') on conflict do nothing;
