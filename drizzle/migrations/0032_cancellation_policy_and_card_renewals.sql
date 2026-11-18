create table public.cancellation_policy (
  id boolean primary key default true check (id),
  cancel_hours integer not null default 12,
  free_misses integer not null default 2,
  fine_cents integer not null default 15000,
  updated_at timestamptz not null default now()
);
insert into public.cancellation_policy (id) values (true);

grant select on public.cancellation_policy to authenticated;
grant all on public.cancellation_policy to service_role;

alter table public.cancellation_policy enable row level security;

create policy "authenticated read cancellation_policy"
  on public.cancellation_policy for select to authenticated using (true);
create policy "admin update cancellation_policy"
  on public.cancellation_policy for update to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

alter table public.token_plans add column if not exists no_show_penalty boolean not null default false;
update public.token_plans set no_show_penalty = true where id in (
  'b4302499-2791-4d01-bde8-345ccfc0d59d',
  '4033499d-df08-4417-a30e-3148ec4dd080',
  '70384626-7cae-4fe5-8f44-500cce69d6f8',
  'ac1d5e42-da4a-49ab-a1d0-bf10a8e7d14a'
);

create table public.no_shows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  booking_id uuid references public.bookings(id),
  kind text not null check (kind in ('no_asistio', 'cancelacion_tardia')),
  cycle_closed boolean not null default false,
  waived boolean not null default false,
  waived_by uuid,
  waived_at timestamptz,
  fee_id uuid references public.membership_fees(id),
  created_at timestamptz not null default now()
);
create index idx_no_shows_user on public.no_shows(user_id);

grant select on public.no_shows to authenticated;
grant all on public.no_shows to service_role;

alter table public.no_shows enable row level security;

create policy "user read own no_shows"
  on public.no_shows for select to authenticated using (auth.uid() = user_id);
create policy "staff read no_shows"
  on public.no_shows for select to authenticated
  using (public.is_staff(auth.uid()) or public.has_role(auth.uid(), 'admin'));

create table public.saved_cards (
  user_id uuid primary key,
  provider text not null default 'stripe',
  customer_id text not null,
  payment_method_id text not null,
  brand text not null default '',
  last4 text not null default '',
  auto_renew boolean not null default true,
  consent_accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select on public.saved_cards to authenticated;
grant update (auto_renew) on public.saved_cards to authenticated;
grant all on public.saved_cards to service_role;

alter table public.saved_cards enable row level security;

create policy "user read own card"
  on public.saved_cards for select to authenticated using (auth.uid() = user_id);
create policy "staff read cards"
  on public.saved_cards for select to authenticated
  using (public.is_staff(auth.uid()) or public.has_role(auth.uid(), 'admin'));
create policy "user update own auto_renew"
  on public.saved_cards for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table public.renewal_opt_outs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  cycle_end timestamptz not null,
  decided_at timestamptz not null default now(),
  unique (user_id, cycle_end)
);

grant select, insert on public.renewal_opt_outs to authenticated;
grant all on public.renewal_opt_outs to service_role;

alter table public.renewal_opt_outs enable row level security;

create policy "user read own opt_outs"
  on public.renewal_opt_outs for select to authenticated using (auth.uid() = user_id);
create policy "user insert own opt_outs"
  on public.renewal_opt_outs for insert to authenticated with check (auth.uid() = user_id);
create policy "staff read opt_outs"
  on public.renewal_opt_outs for select to authenticated
  using (public.is_staff(auth.uid()) or public.has_role(auth.uid(), 'admin'));

create or replace function public.register_falta(_user_id uuid, _booking_id uuid, _kind text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _ns uuid;
  _policy public.cancellation_policy;
  _count int;
  _fee uuid;
  _penalized boolean;
begin
  select id into _ns from public.no_shows
   where booking_id = _booking_id and not waived limit 1;
  if found then return _ns; end if;

  insert into public.no_shows (user_id, booking_id, kind)
    values (_user_id, _booking_id, _kind) returning id into _ns;

  select * into _policy from public.cancellation_policy limit 1;
  if not found then
    _policy.cancel_hours := 12; _policy.free_misses := 2; _policy.fine_cents := 15000;
  end if;

  select exists (
    select 1 from public.transactions t
    join public.token_plans p on p.id = t.plan_id
    where t.user_id = _user_id and t.status = 'completed' and p.no_show_penalty
      and t.access_ends_at is not null
      and now() between t.access_starts_at and t.access_ends_at
  ) into _penalized;

  if not _penalized then return _ns; end if;

  select count(*) into _count from public.no_shows
   where user_id = _user_id and not waived and not cycle_closed;

  if _count > _policy.free_misses then
    insert into public.membership_fees (user_id, booking_id, amount_cents, reason, status)
      values (_user_id, _booking_id, _policy.fine_cents,
              'Multa por ' || _count || 'ª falta', 'pending_charge')
      returning id into _fee;
    update public.no_shows set fee_id = _fee where id = _ns;
    update public.no_shows set cycle_closed = true
     where user_id = _user_id and not waived and not cycle_closed;
  end if;

  return _ns;
end;
$function$;

create or replace function public.cancel_booking(_booking_id uuid)
returns bookings
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _uid uuid := auth.uid();
  _b public.bookings;
  _c public.classes;
  _hours_left numeric;
  _cancel_hours int;
begin
  if _uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into _b from public.bookings where id = _booking_id;
  if not found then raise exception 'BOOKING_NOT_FOUND'; end if;
  if _b.user_id <> _uid and not public.has_role(_uid, 'admin') then raise exception 'FORBIDDEN'; end if;
  if _b.status <> 'reservada' then raise exception 'ALREADY_CANCELLED'; end if;
  select * into _c from public.classes where id = _b.class_id;

  update public.bookings set status = 'cancelada' where id = _booking_id returning * into _b;

  select cancel_hours into _cancel_hours from public.cancellation_policy limit 1;
  _cancel_hours := coalesce(_cancel_hours, 12);
  _hours_left := extract(epoch from (_c.starts_at - now())) / 3600.0;

  if _hours_left >= _cancel_hours then
    if _b.tokens_spent > 0 then
      insert into public.token_ledger (user_id, delta, reason, credit_kind)
        values (_b.user_id, _b.tokens_spent, 'Cancelación con reembolso', _b.credit_kind);
    end if;
  else
    perform public.register_falta(_b.user_id, _b.id, 'cancelacion_tardia');
  end if;

  return _b;
end;
$function$;

create or replace function public.mark_no_show(_booking_id uuid, _penalty_cents integer default 15000)
returns check_ins
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  if _b.id is not null and _b.user_id is not null then
    perform public.register_falta(_b.user_id, _b.id, 'no_asistio');
  end if;

  return _row;
end;
$function$;

create or replace function public.clear_check_in(_booking_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _ci public.check_ins;
begin
  if not (public.is_staff(auth.uid()) or public.has_role(auth.uid(), 'admin')) then
    raise exception 'FORBIDDEN';
  end if;
  delete from public.check_ins where booking_id = _booking_id returning * into _ci;
  if not found then return false; end if;
  if _ci.status = 'no_show' then
    delete from public.no_shows where booking_id = _booking_id and kind = 'no_asistio' and not waived;
    delete from public.membership_fees
     where booking_id = _booking_id and status = 'pending_charge' and charged_at is null;
  end if;
  return true;
end;
$function$;

create or replace function public.miss_status(_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  _policy public.cancellation_policy;
  _count int;
  _fees jsonb;
  _last_charge jsonb;
  _message text;
  _fine text;
begin
  if auth.uid() is null or (auth.uid() <> _user_id and not (public.has_role(auth.uid(), 'admin') or public.is_staff(auth.uid()))) then
    raise exception 'FORBIDDEN';
  end if;

  select * into _policy from public.cancellation_policy limit 1;
  if not found then
    _policy.cancel_hours := 12; _policy.free_misses := 2; _policy.fine_cents := 15000;
  end if;
  _fine := trim(to_char(_policy.fine_cents / 100.0, 'FM999999990.##'));

  select count(*) into _count from public.no_shows
   where user_id = _user_id and not waived and not cycle_closed;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', f.id, 'amount_cents', f.amount_cents, 'reason', f.reason, 'created_at', f.created_at
  ) order by f.created_at desc), '[]'::jsonb) into _fees
  from public.membership_fees f
  where f.user_id = _user_id and f.status = 'pending_charge';

  select jsonb_build_object('amount_cents', f.amount_cents, 'charged_at', f.charged_at, 'reason', f.reason)
    into _last_charge
  from public.membership_fees f
  where f.user_id = _user_id and f.status = 'charged'
  order by f.charged_at desc limit 1;

  if _count = 1 then
    _message := 'Tienes 1 falta. Recuerda que puedes cancelar sin costo hasta ' || _policy.cancel_hours || ' h antes. A la ' || (_policy.free_misses + 1) || 'ª falta se cobra una multa de $' || _fine || '.';
  elsif _count = _policy.free_misses then
    _message := 'Tienes ' || _count || ' faltas. Tu próxima falta generará una multa de $' || _fine || '.';
  elsif _count > 1 then
    _message := 'Tienes ' || _count || ' faltas. A la ' || (_policy.free_misses + 1) || 'ª falta se cobra una multa de $' || _fine || '.';
  else
    _message := null;
  end if;

  return jsonb_build_object(
    'count', _count,
    'free_misses', _policy.free_misses,
    'fine_cents', _policy.fine_cents,
    'cancel_hours', _policy.cancel_hours,
    'pending_fees', _fees,
    'last_charge', _last_charge,
    'message', _message
  );
end;
$function$;

create or replace function public.waive_no_show(_no_show_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _ns public.no_shows;
begin
  if not (public.is_staff(auth.uid()) or public.has_role(auth.uid(), 'admin')) then
    raise exception 'FORBIDDEN';
  end if;
  update public.no_shows
     set waived = true, waived_by = auth.uid(), waived_at = now()
   where id = _no_show_id and not waived
   returning * into _ns;
  if not found then raise exception 'NOT_FOUND'; end if;
  if _ns.fee_id is not null then
    update public.membership_fees set status = 'condonada'
     where id = _ns.fee_id and status = 'pending_charge';
  end if;
end;
$function$;

create or replace function public.waive_membership_fee(_fee_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'FORBIDDEN';
  end if;
  update public.membership_fees set status = 'condonada'
   where id = _fee_id and status = 'pending_charge';
  if not found then raise exception 'NOT_FOUND'; end if;
end;
$function$;

create or replace function public.trg_block_pending_fee()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if NEW.user_id is not null and NEW.user_id = auth.uid() and NEW.status = 'reservada'
     and exists (
       select 1 from public.membership_fees
       where user_id = NEW.user_id and status = 'pending_charge'
     ) then
    raise exception 'PENDING_FINE';
  end if;
  return NEW;
end;
$function$;

drop trigger if exists block_pending_fee on public.bookings;
create trigger block_pending_fee
  before insert on public.bookings
  for each row execute function public.trg_block_pending_fee();

create or replace function public.renewal_status(_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  _ends timestamptz;
  _plan_name text;
  _card public.saved_cards;
  _opt boolean;
  _days int;
begin
  if auth.uid() is null or (auth.uid() <> _user_id and not (public.has_role(auth.uid(), 'admin') or public.is_staff(auth.uid()))) then
    raise exception 'FORBIDDEN';
  end if;

  select max(t.access_ends_at) into _ends
    from public.transactions t
    join public.token_plans p on p.id = t.plan_id
   where t.user_id = _user_id and t.status = 'completed' and p.no_show_penalty
     and t.access_ends_at is not null;
  if _ends is null then return null; end if;

  select p.name into _plan_name
    from public.transactions t
    join public.token_plans p on p.id = t.plan_id
   where t.user_id = _user_id and t.status = 'completed' and p.no_show_penalty
     and t.access_ends_at = _ends
   limit 1;

  select * into _card from public.saved_cards where user_id = _user_id;
  select exists (
    select 1 from public.renewal_opt_outs where user_id = _user_id and cycle_end = _ends
  ) into _opt;
  _days := greatest(0, ceil(extract(epoch from (_ends - now())) / 86400.0))::int;

  return jsonb_build_object(
    'plan_name', _plan_name,
    'ends_at', _ends,
    'days_left', _days,
    'has_card', _card.user_id is not null,
    'auto_renew', coalesce(_card.auto_renew, false),
    'card_brand', coalesce(_card.brand, ''),
    'card_last4', coalesce(_card.last4, ''),
    'opted_out', _opt,
    'show_modal', (_ends > now() and _days <= 7 and (_card.user_id is null or not _card.auto_renew) and not _opt)
  );
end;
$function$;

create or replace function public.opt_out_renewal()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _ends timestamptz;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select max(t.access_ends_at) into _ends
    from public.transactions t
    join public.token_plans p on p.id = t.plan_id
   where t.user_id = auth.uid() and t.status = 'completed' and p.no_show_penalty
     and t.access_ends_at is not null and t.access_ends_at > now();
  if _ends is null then raise exception 'NOT_FOUND'; end if;
  insert into public.renewal_opt_outs (user_id, cycle_end)
    values (auth.uid(), _ends)
    on conflict (user_id, cycle_end) do nothing;
end;
$function$;

create or replace function public.due_renewals()
returns table (
  user_id uuid,
  plan_id uuid,
  renewal_plan_id uuid,
  plan_name text,
  amount_cents integer,
  customer_id text,
  payment_method_id text,
  ends_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  return query
  with latest as (
    select distinct on (t.user_id)
           t.user_id, t.plan_id, t.access_ends_at,
           p.name as plan_name, p.price_cents,
           coalesce(p.renews_plan_id, p.id) as family
      from public.transactions t
      join public.token_plans p on p.id = t.plan_id
     where t.status = 'completed' and p.no_show_penalty and t.access_ends_at is not null
     order by t.user_id, t.access_ends_at desc
  )
  select l.user_id, l.plan_id,
         coalesce(r.id, l.plan_id) as renewal_plan_id,
         coalesce(r.name, l.plan_name) as plan_name,
         coalesce(r.price_cents, l.price_cents) as amount_cents,
         sc.customer_id, sc.payment_method_id, l.access_ends_at
    from latest l
    join public.saved_cards sc on sc.user_id = l.user_id and sc.auto_renew
    left join lateral (
      select p2.id, p2.name, p2.price_cents
        from public.token_plans p2
       where p2.renews_plan_id = l.family and p2.active
       order by p2.sort_order
       limit 1
    ) r on true
   where l.access_ends_at <= now();
end;
$function$;

create or replace function public.trg_set_membership_access()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE _p public.token_plans; _prev timestamptz; _start timestamptz;
BEGIN
 IF NEW.plan_id IS NULL OR NEW.status <> 'completed' OR NEW.access_ends_at IS NOT NULL THEN RETURN NEW; END IF;
 SELECT * INTO _p FROM public.token_plans WHERE id=NEW.plan_id;
 IF NOT FOUND OR _p.daily_class_limit IS NULL THEN RETURN NEW; END IF;
 SELECT max(t.access_ends_at) INTO _prev FROM public.transactions t
  WHERE t.user_id=NEW.user_id AND t.status='completed'
    AND t.plan_id IN (coalesce(_p.renews_plan_id,_p.id), _p.id);
 IF _prev IS NOT NULL AND _prev > now() - interval '1 day' THEN
  NEW.access_starts_at := _prev + interval '1 second';
  NEW.access_ends_at := public.membership_end(NEW.access_starts_at,coalesce(_p.validity_days,180));
 ELSE
  _start := public.purchase_validity_start(coalesce(NEW.created_at,now()),_p.membership_starts_at);
  NEW.access_starts_at := _start;
  NEW.access_ends_at := public.membership_end(_start,coalesce(_p.validity_days,30));
 END IF;
 RETURN NEW;
END;
$function$;