-- ============================================================================
-- DATOS DE DEMOSTRACIÓN: horarios del resto de agosto (24-31) con
-- reservaciones ficticias, para poder ver el flujo de check-in / lista de
-- espera / cancelaciones funcionando con datos reales en el calendario.
-- Todo puede borrarse después buscando por el comentario en `instructor`
-- o simplemente truncando las clases con starts_at en ese rango.
-- ============================================================================
DO $$
DECLARE
  _coach_id uuid;
  _class_id uuid;
  _demo_user uuid;
  _d int;
  _users uuid[];
  _u uuid;
  _n int;
BEGIN
  -- Toma hasta 8 usuarios existentes (clientes reales de profiles) para
  -- generar reservaciones ficticias; si no hay suficientes, se salta.
  SELECT array_agg(id) INTO _users FROM (
    SELECT p.id FROM public.profiles p
    LEFT JOIN public.staff_profiles sp ON sp.user_id = p.id
    WHERE sp.id IS NULL
    LIMIT 8
  ) x;

  IF _users IS NULL OR array_length(_users, 1) IS NULL THEN
    RAISE NOTICE 'No hay clientes en profiles todavía; se omiten las reservaciones ficticias.';
    RETURN;
  END IF;

  SELECT id INTO _coach_id FROM public.staff_profiles WHERE role = 'coach' LIMIT 1;

  FOR _d IN 24..31 LOOP
    -- Salta domingos (dow 0) igual que el resto del horario del estudio.
    CONTINUE WHEN extract(dow FROM make_date(2026, 8, _d)) = 0;

    INSERT INTO public.classes (module_key, room, instructor, coach_id, starts_at, capacity, duration_min, tokens_cost, active)
    VALUES ('reformer', 'Reformer Studio', 'Ana Ruiz', _coach_id,
            (make_date(2026, 8, _d) + time '07:00') AT TIME ZONE 'America/Monterrey', 10, 50, 1, true)
    RETURNING id INTO _class_id;

    -- Reservaciones ficticias: llena entre 4 y 8 lugares, algunas con
    -- check-in ya hecho para poder ver el flujo completo.
    _n := 0;
    FOREACH _u IN ARRAY _users LOOP
      _n := _n + 1;
      EXIT WHEN _n > 6;
      INSERT INTO public.bookings (user_id, class_id, tokens_spent, status, seat_number)
      VALUES (_u, _class_id, 1, 'reservada', _n)
      ON CONFLICT (user_id, class_id) DO NOTHING;
      IF _n <= 3 THEN
        INSERT INTO public.check_ins (booking_id, status)
        SELECT id, 'a_tiempo' FROM public.bookings WHERE user_id = _u AND class_id = _class_id
        ON CONFLICT (booking_id) DO NOTHING;
      END IF;
    END LOOP;

    INSERT INTO public.classes (module_key, room, instructor, coach_id, starts_at, capacity, duration_min, tokens_cost, active)
    VALUES ('reformer', 'Reformer Studio', 'Ana Ruiz', _coach_id,
            (make_date(2026, 8, _d) + time '18:00') AT TIME ZONE 'America/Monterrey', 10, 50, 1, true)
    RETURNING id INTO _class_id;

    _n := 0;
    FOREACH _u IN ARRAY _users LOOP
      _n := _n + 1;
      IF _n <= 5 THEN
        INSERT INTO public.bookings (user_id, class_id, tokens_spent, status, seat_number)
        VALUES (_u, _class_id, 1, 'reservada', _n)
        ON CONFLICT (user_id, class_id) DO NOTHING;
      ELSIF _n <= 7 THEN
        -- lista de espera: la clase de las 18:00 se llena rápido
        INSERT INTO public.bookings (user_id, class_id, tokens_spent, status, waitlisted_at)
        VALUES (_u, _class_id, 1, 'lista_espera', now())
        ON CONFLICT (user_id, class_id) DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;
END $$;
