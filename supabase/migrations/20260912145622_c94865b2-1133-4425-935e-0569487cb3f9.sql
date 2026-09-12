create table public.clip_orders (
    id uuid primary key default gen_random_uuid(),
    payment_request_id text,
    status text not null default 'created',
    kind text not null check (kind in ('plan', 'merch', 'merch_cart')),
    user_id uuid not null references auth.users(id) on delete cascade,
    plan_id uuid references public.token_plans(id) on delete set null,
    product_id uuid references public.products(id) on delete set null,
    qty int,
    items jsonb default '[]'::jsonb,
    amount_cents int not null,
    currency text not null default 'MXN',
    description text not null,
    external_ref text unique,
    metadata jsonb default '{}'::jsonb,
    fulfilled boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

comment on table public.clip_orders is 'Órdenes de pago creadas vía Clip Checkout redireccionado';
comment on column public.clip_orders.status is 'Estado reportado por Clip: created, pending, completed, canceled, expired, failed';
comment on column public.clip_orders.kind is 'plan = paquete/membresía; merch = producto individual; merch_cart = carrito';

grant all on public.clip_orders to service_role;
grant select, update on public.clip_orders to authenticated;

alter table public.clip_orders enable row level security;

create index idx_clip_orders_user on public.clip_orders (user_id);
create index idx_clip_orders_payment_request on public.clip_orders (payment_request_id);
create index idx_clip_orders_external_ref on public.clip_orders (external_ref);
create unique index idx_clip_orders_payment_request_unique on public.clip_orders (payment_request_id) where payment_request_id is not null;

create policy "Users can read own clip orders"
on public.clip_orders
for select
to authenticated
using (user_id = auth.uid());