-- Cobro automático con tarjeta guardada para varias membresías + límite
-- semanal (Membresía Mensual DorisFisio: 1 sesión por semana) + aviso de
-- vencimiento para membresías de créditos.
--
-- Conceptos:
--   * Membresía = plan con daily_class_limit (Founders, The Everyday, Two a Day)
--     o con weekly_class_limit (Membresía Mensual DorisFisio).
--   * Familia = coalesce(renews_plan_id, id). Founders base, Founders mensual y
--     Founders semestral son la misma familia.
--   * Las membresías por día comparten una sola línea de tiempo (cada nueva
--     empieza donde termina la anterior), así que de esas solo cuenta la más
--     reciente. Las de créditos (DorisFisio) van por familia; su periodo es la
--     vigencia del lote de créditos.
--   * token_plans.card_renewable: el plan se puede cobrar solo con la tarjeta
--     guardada (Founders mensual, The Everyday, Two a Day). auto_renewals: qué
--     membresías eligió la clienta (una fila por familia; puede tener varias).

-- 1. Planes
alter table public.token_plans add column if not exists weekly_class_limit integer
  check (weekly_class_limit is null or weekly_class_limit > 0);
alter table public.token_plans add column if not exists card_renewable boolean not null default false;

-- DorisFisio no es recurrente (se compra cada vez); solo lleva el límite semanal.
update public.token_plans set weekly_class_limit = 1
 where name = 'Membresía Mensual DorisFisio';
update public.token_plans set card_renewable = true
 where name in ('Founders Access · Mensual recurrente', 'The Everyday', 'Two a Day');

-- 2. Membresías con cobro automático elegidas por cada clienta
create table if not exists public.auto_renewals (
  user_id uuid not null references auth.users(id) on delete cascade,
  family_id uuid not null references public.token_plans(id),
  plan_id uuid not null references public.token_plans(id),
  created_at timestamptz not null default now(),
  primary key (user_id, family_id)
);
alter table public.auto_renewals enable row level security;
drop policy if exists "auto_renewals_read" on public.auto_renewals;
create policy "auto_renewals_read" on public.auto_renewals for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin') or public.is_staff(auth.uid()));
revoke insert, update, delete on public.auto_renewals from anon, authenticated;

-- Lo que ya habían elegido (Founders mensual) pasa a la tabla nueva.
insert into public.auto_renewals (user_id, family_id, plan_id)
select sc.user_id, coalesce(p.renews_plan_id, p.id), p.id
  from public.saved_cards sc join public.token_plans p on p.id = sc.renewal_plan_id
 where sc.auto_renew
on conflict (user_id, family_id) do nothing;

-- 3. Avisos, "no quiero renovar" y cargos pendientes ahora son por familia
--    (dos membresías pueden terminar el mismo día). Las filas viejas quedan
--    con family_id NULL y cuentan para la membresía por día.
alter table public.membership_reminders add column if not exists family_id uuid;
alter table public.membership_reminders drop constraint if exists membership_reminders_pkey;
create unique index if not exists membership_reminders_user_cycle_family
  on public.membership_reminders (user_id, cycle_end, family_id) nulls not distinct;

alter table public.renewal_opt_outs add column if not exists family_id uuid;
alter table public.renewal_opt_outs drop constraint if exists renewal_opt_outs_user_id_cycle_end_key;
create unique index if not exists renewal_opt_outs_user_cycle_family
  on public.renewal_opt_outs (user_id, cycle_end, family_id) nulls not distinct;

drop index if exists public.membership_fees_one_pending_renewal;
create unique index if not exists membership_fees_one_pending_renewal
  on public.membership_fees (user_id, cycle_end, renewal_plan_id)
  where kind = 'renovacion' and status = 'pending_charge';

-- 4. Periodo vigente de cada membresía
create or replace function public.membership_cycles(_user_id uuid default null)
returns table(user_id uuid, family_id uuid, plan_id uuid, plan_name text, is_daily boolean,
              starts_at timestamptz, ends_at timestamptz, stripe_subscription boolean)
language sql stable security definer set search_path to 'public' as $$
  with periods as (
    select t.user_id, coalesce(p.renews_plan_id, p.id) as family_id, p.id as plan_id, p.name as plan_name,
           p.daily_class_limit is not null as is_daily,
           coalesce(t.access_starts_at, l.starts_at) as starts_at,
           coalesce(t.access_ends_at, l.expires_at) as ends_at,
           -- Compras con suscripción de Stripe: Stripe ya las cobra solo.
           (p.recurring and (t.external_ref like 'session\_%' or t.external_ref like 'invoice\_%')) as stripe_subscription
      from public.transactions t
      join public.token_plans p on p.id = t.plan_id
      left join lateral (
        select min(cl.starts_at) as starts_at, max(cl.expires_at) as expires_at
          from public.credit_lots cl where cl.transaction_id = t.id
      ) l on true
     where t.status = 'completed'
       and (p.daily_class_limit is not null or p.weekly_class_limit is not null)
       and (_user_id is null or t.user_id = _user_id)
  ),
  daily as (
    select distinct on (d.user_id) d.* from periods d
     where d.is_daily and d.ends_at is not null
     order by d.user_id, d.ends_at desc
  ),
  credit as (
    select distinct on (c.user_id, c.family_id) c.* from periods c
     where not c.is_daily and c.ends_at is not null
     order by c.user_id, c.family_id, c.ends_at desc
  )
  select * from daily union all select * from credit
$$;
revoke all on function public.membership_cycles(uuid) from public, anon, authenticated;

-- Plan con el que se renueva cada familia (Founders -> Founders mensual).
create or replace function public.renewable_plan_for(_family_id uuid)
returns public.token_plans language sql stable security definer set search_path to 'public' as $$
  select * from public.token_plans
   where active and card_renewable and (id = _family_id or renews_plan_id = _family_id)
   order by (id = _family_id) desc, sort_order limit 1
$$;
revoke all on function public.renewable_plan_for(uuid) from public, anon, authenticated;

-- 5. Renovaciones que toca cobrar hoy
drop function if exists public.due_renewals();
create function public.due_renewals()
returns table(user_id uuid, plan_id uuid, renewal_plan_id uuid, plan_name text, amount_cents integer,
              customer_id text, payment_method_id text, ends_at timestamptz, stripe_env text)
language plpgsql security definer set search_path to 'public' as $$
begin
  return query
  select c.user_id, c.plan_id, r.id, r.name, r.price_cents, sc.customer_id, sc.payment_method_id,
         c.ends_at, sc.stripe_env
    from public.membership_cycles() c
    join public.auto_renewals ar on ar.user_id = c.user_id and ar.family_id = c.family_id
    join public.token_plans r on r.id = ar.plan_id and r.active and r.card_renewable
    join public.saved_cards sc on sc.user_id = c.user_id and sc.auto_renew
   where not c.stripe_subscription
     and (c.ends_at at time zone 'America/Monterrey')::date <= (now() at time zone 'America/Monterrey')::date
     -- No cobrar membresías que terminaron hace mucho (clienta que ya se fue).
     and c.ends_at > now() - interval '7 days'
     and not exists (
       select 1 from public.renewal_opt_outs o
        where o.user_id = c.user_id and o.cycle_end = c.ends_at
          and (o.family_id = c.family_id or (o.family_id is null and c.is_daily))
     )
     and not exists (
       select 1 from public.membership_fees f
        where f.user_id = c.user_id and f.kind = 'renovacion' and f.cycle_end = c.ends_at
          and f.renewal_plan_id = r.id and f.status in ('pending_charge', 'charged')
     );
end; $$;
revoke all on function public.due_renewals() from public, anon, authenticated;

-- 6. Avisos de vencimiento (10 días antes), uno por membresía y periodo
drop function if exists public.due_membership_reminders();
create function public.due_membership_reminders()
returns table(user_id uuid, email text, full_name text, plan_name text, ends_at timestamptz,
              is_founders boolean, auto_renew_plan text, family_id uuid)
language plpgsql security definer set search_path to 'public' as $$
begin
  return query
  select c.user_id, pr.email, pr.full_name, c.plan_name, c.ends_at,
         c.family_id = 'b4302499-2791-4d01-bde8-345ccfc0d59d'::uuid,
         case when c.stripe_subscription then c.plan_name else (
           select r.name from public.auto_renewals ar
             join public.token_plans r on r.id = ar.plan_id
             join public.saved_cards sc on sc.user_id = ar.user_id and sc.auto_renew
            where ar.user_id = c.user_id and ar.family_id = c.family_id) end,
         c.family_id
    from public.membership_cycles() c join public.profiles pr on pr.id = c.user_id
   where pr.email is not null and pr.email <> ''
     and c.ends_at > now()
     and (c.ends_at at time zone 'America/Monterrey')::date
         <= (now() at time zone 'America/Monterrey')::date + 10
     and not exists (
       select 1 from public.membership_reminders m
        where m.user_id = c.user_id and m.cycle_end = c.ends_at
          and (m.family_id = c.family_id or (m.family_id is null and c.is_daily))
     );
end; $$;
revoke all on function public.due_membership_reminders() from public, anon, authenticated;

-- 7. Estado de renovación para la app: la membresía que pide atención primero
create or replace function public.renewal_status(_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  _founders constant uuid := 'b4302499-2791-4d01-bde8-345ccfc0d59d';
  _c record; _pick record; _first record; _card public.saved_cards; _opt boolean; _days int;
  _is_founders boolean; _monthly record; _semestral record; _everyday record; _chosen text;
  _renew public.token_plans; _has_first boolean := false; _has_pick boolean := false;
begin
  if auth.uid() is null or (auth.uid() <> _user_id and not (public.has_role(auth.uid(), 'admin') or public.is_staff(auth.uid()))) then
    raise exception 'FORBIDDEN';
  end if;
  select * into _card from public.saved_cards where user_id = _user_id;

  for _c in
    select mc.*,
           exists (select 1 from public.auto_renewals ar where ar.user_id = mc.user_id and ar.family_id = mc.family_id) as chosen,
           exists (select 1 from public.renewal_opt_outs o where o.user_id = mc.user_id and o.cycle_end = mc.ends_at
                    and (o.family_id = mc.family_id or (o.family_id is null and mc.is_daily))) as opted
      from public.membership_cycles(_user_id) mc
     order by (mc.ends_at > now()) desc, case when mc.ends_at > now() then mc.ends_at end asc, mc.ends_at desc
  loop
    if not _has_first then _first := _c; _has_first := true; end if;
    if _c.ends_at > now() and not _c.chosen and not _c.opted and not _c.stripe_subscription then
      _pick := _c; _has_pick := true; exit;
    end if;
  end loop;
  if not _has_first then return null; end if;
  if not _has_pick then _pick := _first; end if;

  _opt := _pick.opted;
  _days := greatest(0, ceil(extract(epoch from (_pick.ends_at - now())) / 86400.0))::int;
  _is_founders := _pick.family_id = _founders;

  select id, name, price_cents into _monthly from public.token_plans
   where renews_plan_id = _founders and validity_months is not null and active order by sort_order limit 1;
  select id, name, price_cents into _semestral from public.token_plans
   where renews_plan_id = _founders and validity_months is null and active order by sort_order limit 1;
  select id, name, price_cents into _everyday from public.token_plans where name = 'The Everyday' and active limit 1;

  _chosen := case when _card.user_id is not null and _card.auto_renew then (
    select r.name from public.auto_renewals ar join public.token_plans r on r.id = ar.plan_id
     where ar.user_id = _user_id and ar.family_id = _pick.family_id) end;
  _renew := public.renewable_plan_for(_pick.family_id);

  return jsonb_build_object(
    'plan_name', _pick.plan_name,
    'family_id', _pick.family_id,
    'ends_at', _pick.ends_at,
    'days_left', _days,
    'has_card', _card.user_id is not null,
    'auto_renew', _chosen is not null,
    'card_brand', coalesce(_card.brand, ''),
    'card_last4', coalesce(_card.last4, ''),
    'renewal_plan_name', _chosen,
    'opted_out', _opt,
    'stripe_subscription', _pick.stripe_subscription,
    'renewable_plan', case when _renew.id is not null and not _is_founders then
        jsonb_build_object('id', _renew.id, 'name', _renew.name, 'price_cents', _renew.price_cents) end,
    'is_founders', _is_founders,
    'founders_options', case when _is_founders then jsonb_build_object(
        'monthly', jsonb_build_object('id', _monthly.id, 'name', _monthly.name, 'price_cents', _monthly.price_cents),
        'semestral', jsonb_build_object('id', _semestral.id, 'name', _semestral.name, 'price_cents', _semestral.price_cents),
        'everyday', jsonb_build_object('id', _everyday.id, 'name', _everyday.name, 'price_cents', _everyday.price_cents)
      ) end,
    'show_founders_modal', (_is_founders and _pick.ends_at > now() and _days <= 15
                            and _chosen is null and not _opt),
    'show_modal', (not _is_founders and not _pick.stripe_subscription and _pick.ends_at > now()
                   and _days <= 10 and _chosen is null and not _opt)
  );
end; $$;
grant execute on function public.renewal_status(uuid) to authenticated;

-- 8. "No quiero renovar" (de la membresía indicada o la membresía por día)
drop function if exists public.opt_out_renewal();
create or replace function public.opt_out_renewal(_family_id uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare _c record;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into _c from public.membership_cycles(auth.uid()) mc
   where mc.ends_at > now() and (case when _family_id is null then mc.is_daily else mc.family_id = _family_id end)
   order by mc.ends_at limit 1;
  if not found then raise exception 'NOT_FOUND'; end if;
  insert into public.renewal_opt_outs (user_id, cycle_end, family_id) values (auth.uid(), _c.ends_at, _c.family_id)
    on conflict do nothing;
  delete from public.auto_renewals where user_id = auth.uid() and family_id = _c.family_id;
end; $$;
revoke all on function public.opt_out_renewal(uuid) from public, anon;
grant execute on function public.opt_out_renewal(uuid) to authenticated;

-- 9. Activar / desactivar el cobro automático de una membresía
create or replace function public.enable_auto_renewal_for(_user_id uuid, _plan_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare _p public.token_plans; _family uuid;
begin
  select * into _p from public.token_plans where id = _plan_id and active and card_renewable;
  if not found then raise exception 'PLAN_NOT_RENEWABLE'; end if;
  _family := coalesce(_p.renews_plan_id, _p.id);
  insert into public.auto_renewals (user_id, family_id, plan_id) values (_user_id, _family, _p.id)
    on conflict (user_id, family_id) do update set plan_id = excluded.plan_id;
  update public.saved_cards set auto_renew = true where user_id = _user_id;
  -- Si antes dijo "no quiero renovar" para el periodo actual, ya no aplica.
  delete from public.renewal_opt_outs
   where user_id = _user_id and cycle_end > now() - interval '7 days'
     and (family_id = _family or family_id is null);
end; $$;
revoke all on function public.enable_auto_renewal_for(uuid, uuid) from public, anon, authenticated;
grant execute on function public.enable_auto_renewal_for(uuid, uuid) to service_role;

create or replace function public.set_auto_renewal(_plan_id uuid, _enabled boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
declare _p public.token_plans;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into _p from public.token_plans where id = _plan_id;
  if not found then raise exception 'PLAN_NOT_FOUND'; end if;
  if _enabled then
    if not exists (select 1 from public.saved_cards where user_id = auth.uid()) then
      raise exception 'CARD_REQUIRED';
    end if;
    perform public.enable_auto_renewal_for(auth.uid(), _plan_id);
  else
    delete from public.auto_renewals
     where user_id = auth.uid() and family_id = coalesce(_p.renews_plan_id, _p.id);
  end if;
end; $$;
revoke all on function public.set_auto_renewal(uuid, boolean) from public, anon;
grant execute on function public.set_auto_renewal(uuid, boolean) to authenticated;

-- 10. Membresías que la clienta puede cobrar en automático (perfil)
create or replace function public.my_auto_renewals()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare _out jsonb := '[]'::jsonb; _c record; _r public.token_plans; _chosen uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  for _c in
    select * from public.membership_cycles(auth.uid()) mc
     where mc.ends_at > now() - interval '30 days' order by mc.ends_at
  loop
    _r := public.renewable_plan_for(_c.family_id);
    if _r.id is null and not _c.stripe_subscription then continue; end if;
    select ar.plan_id into _chosen from public.auto_renewals ar
     where ar.user_id = auth.uid() and ar.family_id = _c.family_id;
    _out := _out || jsonb_build_object(
      'family_id', _c.family_id,
      'plan_name', _c.plan_name,
      'ends_at', _c.ends_at,
      'active', _c.ends_at > now(),
      'stripe_subscription', _c.stripe_subscription,
      'enabled', _chosen is not null,
      'renew_plan', case when _r.id is not null then
        jsonb_build_object('id', _r.id, 'name', _r.name, 'price_cents', _r.price_cents) end);
    _chosen := null;
  end loop;
  return _out;
end; $$;
revoke all on function public.my_auto_renewals() from public, anon;
grant execute on function public.my_auto_renewals() to authenticated;

-- 11. Límite semanal (domingo a sábado, hora de Monterrey). Solo para reservas
--     que hace la clienta; recepción puede hacer excepciones. Si además tiene
--     créditos sueltos sin límite (p. ej. una sesión individual), los puede usar.
create or replace function public.assert_weekly_limit(_user_id uuid, _kind text, _at timestamptz, _cost int)
returns void language plpgsql stable security definer set search_path to 'public' as $$
declare _limit int; _free int; _used int;
begin
  if coalesce(_cost, 0) <= 0 then return; end if;
  select max(p.weekly_class_limit) into _limit
    from public.credit_lots l
    join public.transactions t on t.id = l.transaction_id and t.status = 'completed'
    join public.token_plans p on p.id = t.plan_id
   where l.user_id = _user_id and l.credit_kind = _kind and p.weekly_class_limit is not null
     and l.starts_at <= _at and (l.expires_at is null or l.expires_at > _at);
  if _limit is null then return; end if;

  select coalesce(sum(l.remaining), 0) into _free
    from public.credit_lots l
    left join public.transactions t on t.id = l.transaction_id
    left join public.token_plans p on p.id = t.plan_id
   where l.user_id = _user_id and l.credit_kind = _kind and l.remaining > 0
     and (l.expires_at is null or l.expires_at > now()) and p.weekly_class_limit is null;
  if _free >= _cost then return; end if;

  select count(*) into _used
    from public.bookings b join public.classes c on c.id = b.class_id
   where b.user_id = _user_id and b.credit_kind = _kind and b.tokens_spent > 0
     and b.status in ('reservada', 'lista_espera')
     and public.studio_week_start(c.starts_at) = public.studio_week_start(_at);
  if _used >= _limit then raise exception 'WEEKLY_LIMIT_REACHED'; end if;
end; $$;
revoke all on function public.assert_weekly_limit(uuid, text, timestamptz, int) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.book_class(_class_id uuid, _seat integer DEFAULT NULL::integer, _use_credits boolean DEFAULT false)
 RETURNS bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _c public.classes; _b public.bookings; _taken int; _seat int := _seat; _cost int; _need text; _kind text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO _c FROM public.classes WHERE id = _class_id AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'CLASS_NOT_FOUND'; END IF;
  IF _c.starts_at <= now() THEN RAISE EXCEPTION 'CLASS_PAST'; END IF;
  IF _c.starts_at >= public.booking_window_end()
     AND NOT (public.is_staff(_uid) OR public.has_role(_uid, 'admin')) THEN
    RAISE EXCEPTION 'BOOKING_WINDOW';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.waiver_signatures WHERE user_id = _uid) THEN RAISE EXCEPTION 'WAIVER_REQUIRED'; END IF;
  SELECT count(*) INTO _taken FROM public.bookings WHERE class_id = _class_id AND status = 'reservada';
  IF _taken >= _c.capacity THEN RAISE EXCEPTION 'CLASS_FULL'; END IF;
  IF EXISTS (SELECT 1 FROM public.bookings WHERE class_id = _class_id AND user_id = _uid AND status = 'reservada') THEN RAISE EXCEPTION 'ALREADY_BOOKED'; END IF;
  IF _seat IS NOT NULL AND EXISTS (SELECT 1 FROM public.bookings WHERE class_id = _class_id AND seat_number = _seat AND status = 'reservada') THEN RAISE EXCEPTION 'SEAT_TAKEN'; END IF;
  IF _seat IS NULL THEN
    SELECT MIN(s) INTO _seat FROM generate_series(1, _c.capacity) s
      WHERE s NOT IN (SELECT seat_number FROM public.bookings WHERE class_id = _class_id AND status = 'reservada' AND seat_number IS NOT NULL);
  END IF;
  _need := public.class_credit_kind(_class_id);
  IF _need = 'general' THEN
    _kind := 'general';
    _cost := CASE WHEN NOT _use_credits AND public.user_daily_class_limit(_uid, _c.starts_at) IS NOT NULL THEN 0
                  WHEN _use_credits THEN greatest(_c.tokens_cost, 1) ELSE _c.tokens_cost END;
  ELSE
    _kind := public.pick_credit_kind(_uid, _need);
    _cost := greatest(_c.tokens_cost, 1);
  END IF;
  IF _cost > 0 AND public.token_balance_kind(_uid, _kind) < _cost THEN
    RAISE EXCEPTION '%', public.insufficient_credit_code(_need);
  END IF;
  IF NOT (public.is_staff(_uid) OR public.has_role(_uid, 'admin')) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('weekly:' || _uid::text, 0));
    PERFORM public.assert_weekly_limit(_uid, _kind, _c.starts_at, _cost);
  END IF;
  INSERT INTO public.bookings (user_id, class_id, tokens_spent, seat_number, credit_kind) VALUES (_uid, _class_id, _cost, _seat, _kind)
    ON CONFLICT (user_id, class_id) DO UPDATE SET status = 'reservada', tokens_spent = _cost, seat_number = _seat, credit_kind = _kind
    RETURNING * INTO _b;
  IF _cost > 0 THEN
    INSERT INTO public.token_ledger (user_id, delta, reason, credit_kind) VALUES (_uid, -_cost, 'Reserva de clase', _kind);
  END IF;
  RETURN _b;
END; $function$;

CREATE OR REPLACE FUNCTION public.join_waitlist(_class_id uuid)
 RETURNS bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _c public.classes;
  _b public.bookings;
  _need text;
  _kind text;
  _cost int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO _c FROM public.classes WHERE id = _class_id AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'CLASS_NOT_FOUND'; END IF;
  IF _c.starts_at <= now() THEN RAISE EXCEPTION 'CLASS_PAST'; END IF;
  IF _c.starts_at >= public.booking_window_end()
     AND NOT (public.is_staff(_uid) OR public.has_role(_uid, 'admin')) THEN
    RAISE EXCEPTION 'BOOKING_WINDOW';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.waiver_signatures WHERE user_id = _uid) THEN
    RAISE EXCEPTION 'WAIVER_REQUIRED';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.bookings WHERE class_id = _class_id AND user_id = _uid
      AND status IN ('reservada', 'lista_espera')
  ) THEN
    RAISE EXCEPTION 'ALREADY_BOOKED';
  END IF;
  _need := public.class_credit_kind(_class_id);
  _kind := public.pick_credit_kind(_uid, _need);
  _cost := CASE WHEN _need = 'general' THEN _c.tokens_cost ELSE greatest(_c.tokens_cost, 1) END;
  IF public.token_balance_kind(_uid, _kind) < _cost THEN
    RAISE EXCEPTION '%', public.insufficient_credit_code(_need);
  END IF;
  IF NOT (public.is_staff(_uid) OR public.has_role(_uid, 'admin')) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('weekly:' || _uid::text, 0));
    PERFORM public.assert_weekly_limit(_uid, _kind, _c.starts_at, _cost);
  END IF;
  INSERT INTO public.bookings (user_id, class_id, tokens_spent, status, waitlisted_at, credit_kind)
    VALUES (_uid, _class_id, _cost, 'lista_espera', now(), _kind)
    ON CONFLICT (user_id, class_id) DO UPDATE SET status = 'lista_espera', tokens_spent = _cost, waitlisted_at = now(), credit_kind = _kind
    RETURNING * INTO _b;
  INSERT INTO public.token_ledger (user_id, delta, reason, credit_kind) VALUES (_uid, -_cost, 'Lista de espera', _kind);
  RETURN _b;
END;
$function$;
