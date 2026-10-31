-- Lugares para invitados sin cuenta (por ejemplo, alguien que quiere probar la
-- clase). Se guardan como reservaciones sin usuario, con el nombre del
-- invitado: cuentan contra el cupo en todos lados, así la clase no se
-- sobrellena, y no cobran créditos.
ALTER TABLE public.bookings ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS guest_name text;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS guest_phone text;
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_user_or_guest_chk;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_user_or_guest_chk
  CHECK (user_id IS NOT NULL OR nullif(trim(guest_name), '') IS NOT NULL);

CREATE OR REPLACE FUNCTION public.admin_add_guest(_class_id uuid, _guest_name text, _guest_phone text DEFAULT NULL, _seat integer DEFAULT NULL)
 RETURNS bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _c public.classes; _b public.bookings; _taken int; _seat int := _seat; _name text := left(trim(coalesce(_guest_name, '')), 80);
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.is_staff(auth.uid())) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF _name = '' THEN RAISE EXCEPTION 'GUEST_NAME_REQUIRED'; END IF;
  SELECT * INTO _c FROM public.classes WHERE id = _class_id AND active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CLASS_NOT_FOUND'; END IF;
  IF public.is_recovery(auth.uid()) AND NOT public.has_role(auth.uid(), 'admin')
     AND coalesce(_c.module_key, '') <> 'rehabilitacion' THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  SELECT count(*) INTO _taken FROM public.bookings WHERE class_id = _class_id AND status = 'reservada';
  IF _taken >= _c.capacity THEN RAISE EXCEPTION 'CLASS_FULL'; END IF;
  IF _seat IS NOT NULL AND EXISTS (SELECT 1 FROM public.bookings WHERE class_id = _class_id AND seat_number = _seat AND status = 'reservada') THEN RAISE EXCEPTION 'SEAT_TAKEN'; END IF;
  IF _seat IS NULL THEN
    SELECT MIN(s) INTO _seat FROM generate_series(1, _c.capacity) s
      WHERE s NOT IN (SELECT seat_number FROM public.bookings WHERE class_id = _class_id AND status = 'reservada' AND seat_number IS NOT NULL);
  END IF;
  INSERT INTO public.bookings (user_id, class_id, tokens_spent, seat_number, guest_name, guest_phone, credit_kind)
    VALUES (NULL, _class_id, 0, _seat, _name, nullif(left(trim(coalesce(_guest_phone, '')), 30), ''), 'general')
    RETURNING * INTO _b;
  RETURN _b;
END; $function$;
REVOKE EXECUTE ON FUNCTION public.admin_add_guest(uuid, text, text, integer) FROM anon;

-- Bitácora: el invitado aparece con su nombre.
DO $migration$
DECLARE v_def text;
BEGIN
  v_def := pg_get_functiondef('public.trg_log_booking()'::regprocedure);
  IF position('guest_name' IN v_def) = 0 THEN
    v_def := replace(v_def, '_who := coalesce(public.person_label(NEW.user_id),''Usuario'');',
      '_who := coalesce(public.person_label(NEW.user_id), nullif(NEW.guest_name, '''') || '' (invitado)'', ''Usuario'');');
    EXECUTE v_def;
  END IF;

  v_def := pg_get_functiondef('public.trg_log_checkin()'::regprocedure);
  IF position('guest_name' IN v_def) = 0 THEN
    v_def := replace(v_def, 'SELECT b.user_id, coalesce(c.module_key',
      'SELECT b.user_id, coalesce(c.module_key');
    v_def := replace(v_def, '_who := coalesce(public.person_label(_uid),''Usuario'');',
      '_who := coalesce(public.person_label(_uid), (SELECT nullif(guest_name, '''') || '' (invitado)'' FROM public.bookings WHERE id = NEW.booking_id), ''Usuario'');');
    EXECUTE v_def;
  END IF;

  v_def := pg_get_functiondef('public.coach_class_roster(uuid)'::regprocedure);
  IF position('guest_name' IN v_def) = 0 THEN
    v_def := replace(v_def, 'coalesce(nullif(p.full_name, ''''), split_part(coalesce(p.email, ''''), ''@'', 1))::text',
      'coalesce(nullif(p.full_name, ''''), nullif(b.guest_name, '''') || '' (invitado)'', split_part(coalesce(p.email, ''''), ''@'', 1))::text');
    EXECUTE v_def;
  END IF;

  v_def := pg_get_functiondef('public.recovery_sessions(date,date)'::regprocedure);
  IF position('guest_name' IN v_def) = 0 THEN
    v_def := replace(v_def, 'coalesce(nullif(p.full_name, ''''), p.email, ''Cliente'')::text',
      'coalesce(nullif(p.full_name, ''''), p.email, nullif(b.guest_name, '''') || '' (invitado)'', ''Cliente'')::text');
    EXECUTE v_def;
  END IF;
END
$migration$;
