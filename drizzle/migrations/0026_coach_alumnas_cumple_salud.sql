-- Panel de coaches: más información de sus alumnas.
-- * profiles.birth_date (opcional): se pide en el registro y se edita en Mi
--   cuenta o en la ficha del cliente (recepción).
-- * profiles.health_notes: lesiones, embarazo o condiciones que la coach
--   debe saber. Lo escribe la clienta o recepción; la coach lo ve solo para
--   las alumnas de sus clases.
-- * coach_class_roster: agrega estado de llegada, primera visita, visitas,
--   cumpleaños cercano y notas.
-- * coach_insights: números del mes, alumnas frecuentes y cumpleaños de la
--   semana de las alumnas de la coach.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS birth_date date;
--> statement-breakpoint
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS health_notes text;
--> statement-breakpoint
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_birth_date_chk;
--> statement-breakpoint
ALTER TABLE public.profiles ADD CONSTRAINT profiles_birth_date_chk
  CHECK (birth_date IS NULL OR (birth_date >= date '1900-01-01' AND birth_date <= current_date));
--> statement-breakpoint

-- Fecha del cumpleaños de _bd en el año _y (29 de febrero → 28 si no es bisiesto).
CREATE OR REPLACE FUNCTION public.birthday_in_year(_bd date, _y int)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN _bd IS NULL THEN NULL
    WHEN extract(month FROM _bd) = 2 AND extract(day FROM _bd) = 29
         AND NOT (_y % 4 = 0 AND (_y % 100 <> 0 OR _y % 400 = 0))
      THEN make_date(_y, 2, 28)
    ELSE make_date(_y, extract(month FROM _bd)::int, extract(day FROM _bd)::int)
  END
$function$;
--> statement-breakpoint

-- Días entre _d y el cumpleaños más cercano (0 = ese día).
CREATE OR REPLACE FUNCTION public.days_to_birthday(_bd date, _d date)
RETURNS int
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN _bd IS NULL THEN NULL ELSE least(
    abs(public.birthday_in_year(_bd, extract(year FROM _d)::int - 1) - _d),
    abs(public.birthday_in_year(_bd, extract(year FROM _d)::int) - _d),
    abs(public.birthday_in_year(_bd, extract(year FROM _d)::int + 1) - _d)
  ) END
$function$;
--> statement-breakpoint

-- Alta de cuenta: igual que antes + fecha de nacimiento opcional del registro.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare _staff public.staff_profiles; _bd date;
begin
  begin
    _bd := nullif(new.raw_user_meta_data->>'birth_date', '')::date;
    if _bd < date '1900-01-01' or _bd > current_date then _bd := null; end if;
  exception when others then _bd := null;
  end;

  insert into public.profiles (id, full_name, email, phone, birth_date)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''), coalesce(new.email,''), new.raw_user_meta_data->>'phone', _bd)
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role) values (new.id, 'user') on conflict do nothing;

  select * into _staff from public.staff_profiles
    where lower(email) = lower(coalesce(new.email,'')) and user_id is null
    limit 1;
  if found then
    update public.staff_profiles set user_id = new.id, full_name = coalesce(nullif(full_name,''), _staff.full_name)
      where id = _staff.id;
    insert into public.user_roles (user_id, role) values (new.id, _staff.role) on conflict do nothing;
  else
    begin
      perform public.grant_welcome_gift(new.id);
    exception when others then
      raise warning 'grant_welcome_gift failed for %: %', new.id, sqlerrm;
    end;
  end if;

  return new;
end; $function$;
--> statement-breakpoint

-- Guarda cumpleaños y notas de salud. Puede hacerlo la propia clienta,
-- administración o recepción (nunca sobre cuentas del staff).
CREATE OR REPLACE FUNCTION public.set_client_details(_user_id uuid, _birth_date date, _health_notes text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF auth.uid() <> _user_id THEN
    IF NOT (public.has_role(auth.uid(), 'admin')
            OR (public.has_role(auth.uid(), 'staff') AND public.is_staff(auth.uid()))) THEN
      RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = _user_id) THEN
      RAISE EXCEPTION 'FORBIDDEN';
    END IF;
  END IF;
  IF _birth_date IS NOT NULL AND (_birth_date < date '1900-01-01' OR _birth_date > current_date) THEN
    RAISE EXCEPTION 'INVALID_BIRTH_DATE';
  END IF;
  UPDATE public.profiles
     SET birth_date = _birth_date,
         health_notes = nullif(left(trim(coalesce(_health_notes, '')), 500), '')
   WHERE id = _user_id;
END;
$function$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.set_client_details(uuid, date, text) FROM public, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.set_client_details(uuid, date, text) TO authenticated;
--> statement-breakpoint

-- ¿Puede ver la información de alumnas de esta coach? (admin, recepción o la propia coach)
CREATE OR REPLACE FUNCTION public.can_view_coach(_coach_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL AND (
    public.has_role(auth.uid(), 'admin')
    OR (public.has_role(auth.uid(), 'staff') AND public.is_staff(auth.uid()))
    OR EXISTS (SELECT 1 FROM public.staff_profiles s WHERE s.id = _coach_id AND s.user_id = auth.uid() AND s.active)
  )
$function$;
--> statement-breakpoint

DROP FUNCTION IF EXISTS public.coach_class_roster(uuid);
--> statement-breakpoint
CREATE FUNCTION public.coach_class_roster(_class_id uuid)
RETURNS TABLE(booking_id uuid, full_name text, status text, seat_number integer, checked_in boolean,
              checkin_status text, is_guest boolean, first_visit boolean, visits integer,
              birthday_soon boolean, health_notes text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _c public.classes;
BEGIN
  SELECT * INTO _c FROM public.classes WHERE id = _class_id;
  IF NOT FOUND OR NOT public.can_view_coach(_c.coach_id) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  RETURN QUERY
  WITH attended AS (
    SELECT b2.user_id, count(*)::int AS n
      FROM public.bookings b2
      JOIN public.check_ins ci2 ON ci2.booking_id = b2.id AND ci2.status IN ('a_tiempo','tarde')
      JOIN public.classes c2 ON c2.id = b2.class_id
     WHERE b2.user_id IN (SELECT user_id FROM public.bookings WHERE class_id = _class_id AND user_id IS NOT NULL)
       AND c2.starts_at < _c.starts_at
     GROUP BY b2.user_id
  )
  SELECT b.id,
         coalesce(nullif(p.full_name, ''), nullif(b.guest_name, ''), split_part(coalesce(p.email, ''), '@', 1))::text,
         b.status::text,
         b.seat_number,
         coalesce(ci.status IN ('a_tiempo','tarde'), false),
         ci.status::text,
         b.user_id IS NULL,
         b.user_id IS NULL OR coalesce(a.n, 0) = 0,
         coalesce(a.n, 0),
         coalesce(public.days_to_birthday(p.birth_date, (_c.starts_at AT TIME ZONE 'America/Monterrey')::date) <= 3, false),
         p.health_notes
  FROM public.bookings b
  LEFT JOIN public.profiles p ON p.id = b.user_id
  LEFT JOIN public.check_ins ci ON ci.booking_id = b.id
  LEFT JOIN attended a ON a.user_id = b.user_id
  WHERE b.class_id = _class_id
  ORDER BY b.status, b.seat_number NULLS LAST, b.created_at;
END;
$function$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.coach_class_roster(uuid) FROM public, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.coach_class_roster(uuid) TO authenticated;
--> statement-breakpoint

-- Números de la coach en un rango, sus alumnas frecuentes y cumpleaños de la
-- semana (de alumnas que tomaron clase con ella en los últimos 90 días).
CREATE OR REPLACE FUNCTION public.coach_insights(_coach_id uuid, _from timestamptz, _to timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _r jsonb; _today date := (now() AT TIME ZONE 'America/Monterrey')::date;
BEGIN
  IF NOT public.can_view_coach(_coach_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

  WITH cls AS (
    SELECT id FROM public.classes
     WHERE coach_id = _coach_id AND active AND starts_at >= _from AND starts_at < _to AND starts_at < now()
  ), marks AS (
    SELECT b.class_id, b.user_id, ci.status
      FROM public.bookings b JOIN public.check_ins ci ON ci.booking_id = b.id
     WHERE b.class_id IN (SELECT id FROM cls)
  ), per_class AS (
    SELECT c.id, count(m.*) FILTER (WHERE m.status IN ('a_tiempo','tarde')) AS att
      FROM cls c LEFT JOIN marks m ON m.class_id = c.id GROUP BY c.id
  ), top AS (
    SELECT p.full_name, count(*)::int AS n
      FROM marks m JOIN public.profiles p ON p.id = m.user_id
     WHERE m.status IN ('a_tiempo','tarde')
     GROUP BY p.id, p.full_name ORDER BY n DESC, p.full_name LIMIT 8
  ), students AS (
    SELECT DISTINCT b.user_id
      FROM public.bookings b
      JOIN public.classes c ON c.id = b.class_id
      JOIN public.check_ins ci ON ci.booking_id = b.id AND ci.status IN ('a_tiempo','tarde')
     WHERE c.coach_id = _coach_id AND c.starts_at >= now() - interval '90 days' AND b.user_id IS NOT NULL
  ), bdays AS (
    SELECT p.full_name,
           (SELECT d FROM unnest(ARRAY[
              public.birthday_in_year(p.birth_date, extract(year FROM _today)::int),
              public.birthday_in_year(p.birth_date, extract(year FROM _today)::int + 1)]) d
             WHERE d >= _today ORDER BY d LIMIT 1) AS next_bd
      FROM students s JOIN public.profiles p ON p.id = s.user_id
     WHERE p.birth_date IS NOT NULL
  )
  SELECT jsonb_build_object(
    'classes_given', (SELECT count(*) FROM cls),
    'attended', (SELECT count(*) FROM marks WHERE status IN ('a_tiempo','tarde')),
    'late', (SELECT count(*) FROM marks WHERE status = 'tarde'),
    'no_shows', (SELECT count(*) FROM marks WHERE status = 'no_show'),
    'avg_attendance', (SELECT round(avg(att)::numeric, 1) FROM per_class),
    'unique_students', (SELECT count(DISTINCT user_id) FROM marks WHERE status IN ('a_tiempo','tarde') AND user_id IS NOT NULL),
    'top_students', coalesce((SELECT jsonb_agg(jsonb_build_object('name', full_name, 'visits', n)) FROM top), '[]'::jsonb),
    'birthdays', coalesce((SELECT jsonb_agg(jsonb_build_object('name', full_name, 'date', next_bd) ORDER BY next_bd)
                             FROM bdays WHERE next_bd <= _today + 7), '[]'::jsonb)
  ) INTO _r;
  RETURN _r;
END;
$function$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.coach_insights(uuid, timestamptz, timestamptz) FROM public, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.coach_insights(uuid, timestamptz, timestamptz) TO authenticated;
