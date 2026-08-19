-- ============================================================================
-- FASE 3: calendario real de turnos, inventario de recovery bar,
-- datos de ejemplo para demostrar el check-in.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- TURNOS: cada shift_slot ahora define cuántos lugares (spots) necesita,
-- y cada shift_claim se ata a una fecha específica del calendario (no solo
-- al día de la semana genérico), para poder pintar el calendario en
-- verde/amarillo/rojo según cobertura real por día.
-- ----------------------------------------------------------------------------
alter table public.shift_slots
  add column if not exists spots_needed int not null default 3;

alter table public.shift_claims
  add column if not exists for_date date not null default current_date;

alter table public.shift_claims drop constraint if exists shift_claims_shift_slot_id_staff_id_key;
alter table public.shift_claims
  add constraint shift_claims_slot_staff_date_key unique (shift_slot_id, staff_id, for_date);

create index if not exists shift_claims_for_date_idx on public.shift_claims(for_date);

-- deja turno matutino / vespertino con 3 spots cada uno (reemplaza el seed anterior)
update public.shift_slots set spots_needed = 3;

-- ----------------------------------------------------------------------------
-- INVENTARIO — Recovery Bar: agua, barras de proteína, shakes, fruta, geles,
-- gatorade, powerade, electrolitos
-- ----------------------------------------------------------------------------
insert into public.products (name, sku, category, price_cents, stock, low_stock_threshold, unit, unit_size, active) values
('Agua natural 600ml','RB-WATER-600','consumible',2500,60,15,'pieza','600 ml',true),
('Agua mineral 600ml','RB-SPARK-600','consumible',3000,40,10,'pieza','600 ml',true),
('Barra de proteína chocolate','RB-BAR-CHOC','consumible',5500,30,8,'pieza','60 g',true),
('Barra de proteína cacahuate','RB-BAR-PB','consumible',5500,30,8,'pieza','60 g',true),
('Shake de proteína vainilla','RB-SHAKE-VAN','consumible',7500,20,6,'pieza','355 ml',true),
('Shake de proteína chocolate','RB-SHAKE-CHOC','consumible',7500,20,6,'pieza','355 ml',true),
('Licuado verde detox','RB-LIC-GREEN','consumible',6800,15,5,'pieza','400 ml',true),
('Fruta picada (porción)','RB-FRUIT','consumible',4000,20,5,'pieza','1 porción',true),
('Gel energético','RB-GEL','consumible',3500,25,8,'pieza','1 sobre',true),
('Gatorade 600ml','RB-GATOR-600','consumible',3200,40,10,'pieza','600 ml',true),
('Powerade 600ml','RB-POWER-600','consumible',3200,40,10,'pieza','600 ml',true),
('Electrolitos en sobre','RB-ELEC','consumible',3000,35,10,'pieza','1 sobre',true)
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- DATOS DE EJEMPLO — para poder mostrar cómo se ve el check-in en vivo.
-- Crea 4 clientes demo (cuenta + perfil + waiver) y los reserva/checa en
-- clases de HOY con distintos estados (a tiempo, tarde, no-show, sin
-- checar). Fácil de identificar y borrar después: todos llevan
-- "demo+" en el correo.
-- ----------------------------------------------------------------------------
do $$
declare
  _uid uuid;
  _class_am uuid;
  _class_pm uuid;
  _booking uuid;
  i int;
  _names text[] := array['Valentina Reyes','Diego Ponce','Marifer Salas','Luis Cantú'];
  _emails text[] := array['demo+valentina@laatuwellness.com','demo+diego@laatuwellness.com','demo+marifer@laatuwellness.com','demo+luis@laatuwellness.com'];
begin
  -- clase demo de la mañana (si no hay una próxima hoy, crea una)
  select id into _class_am from public.classes
    where starts_at::date = current_date and starts_at::time between '08:00' and '11:00'
    order by starts_at limit 1;
  if _class_am is null then
    insert into public.classes (room, instructor, starts_at, duration_min, capacity)
    values ('Reformer','Ana Ruiz', current_date + time '09:00', 50, 10)
    returning id into _class_am;
  end if;

  select id into _class_pm from public.classes
    where starts_at::date = current_date and starts_at::time between '17:00' and '20:00'
    order by starts_at limit 1;
  if _class_pm is null then
    insert into public.classes (room, instructor, starts_at, duration_min, capacity)
    values ('Reformer','Sofía Lara', current_date + time '18:00', 50, 10)
    returning id into _class_pm;
  end if;

  for i in 1..4 loop
    select id into _uid from auth.users where email = _emails[i];
    if _uid is null then
      _uid := gen_random_uuid();
      insert into auth.users (
        id, instance_id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
      ) values (
        _uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        _emails[i], crypt('DemoLaatu2026!', gen_salt('bf')),
        now(), now(), now(),
        '{"provider":"email","providers":["email"]}',
        jsonb_build_object('full_name', _names[i])
      );
    end if;

    insert into public.profiles (id, full_name, email) values (_uid, _names[i], _emails[i])
      on conflict (id) do nothing;
    insert into public.waiver_signatures (user_id, signature_data, full_name)
      values (_uid, 'demo', _names[i]) on conflict (user_id) do nothing;
    insert into public.token_ledger (user_id, delta, reason) values (_uid, 10, 'Saldo demo') ;

    -- clase de la mañana: 2 asisten (una a tiempo, una tarde), 1 no-show
    if i <= 3 then
      insert into public.bookings (user_id, class_id, tokens_spent, status)
        values (_uid, _class_am, 1, 'reservada')
        on conflict (user_id, class_id) do nothing
        returning id into _booking;
      if _booking is not null then
        if i = 1 then
          insert into public.check_ins (booking_id, status) values (_booking, 'a_tiempo') on conflict do nothing;
        elsif i = 2 then
          insert into public.check_ins (booking_id, status) values (_booking, 'tarde') on conflict do nothing;
        elsif i = 3 then
          insert into public.check_ins (booking_id, status) values (_booking, 'no_show') on conflict do nothing;
        end if;
      end if;
    end if;

    -- clase de la tarde: reservada, todavía sin checar (para poder demostrar el flujo en vivo)
    insert into public.bookings (user_id, class_id, tokens_spent, status)
      values (_uid, _class_pm, 1, 'reservada')
      on conflict (user_id, class_id) do nothing;
  end loop;
end $$;
