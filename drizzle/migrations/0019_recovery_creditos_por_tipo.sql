-- DorisFisio (consultorio de recuperación):
--   1) Créditos etiquetados por tipo. Un crédito de "Upper o Lower" solo sirve
--      para sesiones Upper/Lower y uno de "Full Body" solo para Full Body. Los
--      créditos del estudio (general) no sirven en el consultorio y viceversa.
--   2) Rol "recovery" para Doris: no es coach. Puede programar y ver su
--      consultorio, ver clientes, apartar sesiones cobrando un crédito, editar
--      sus paquetes y revisar sus consultas.

-- ---------------------------------------------------------------------------
-- 1. Tipo de crédito
-- ---------------------------------------------------------------------------
ALTER TABLE public.token_plans ADD COLUMN IF NOT EXISTS credit_kind text NOT NULL DEFAULT 'general';
ALTER TABLE public.token_ledger ADD COLUMN IF NOT EXISTS credit_kind text NOT NULL DEFAULT 'general';
ALTER TABLE public.credit_lots ADD COLUMN IF NOT EXISTS credit_kind text NOT NULL DEFAULT 'general';
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS credit_kind text NOT NULL DEFAULT 'general';
-- En class_types es opcional: vacío = lo decide el programa.
ALTER TABLE public.class_types ADD COLUMN IF NOT EXISTS credit_kind text;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['token_plans', 'token_ledger', 'credit_lots', 'bookings', 'class_types'] LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', t, t || '_credit_kind_chk');
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (credit_kind IS NULL OR credit_kind IN (''general'', ''doris_ul'', ''doris_fb''))',
      t, t || '_credit_kind_chk');
  END LOOP;
END $$;

UPDATE public.token_plans SET credit_kind = 'doris_ul' WHERE id = '1429d807-a2ee-4935-a3e2-de95b95be4ad';
UPDATE public.token_plans SET credit_kind = 'doris_fb' WHERE id = '257dc039-147c-49d3-97f4-b83fd71f9f66';

-- Tipos de sesión del consultorio.
INSERT INTO public.class_types (module_key, name, description, active, sort_order, default_capacity, credit_kind)
SELECT 'rehabilitacion', v.name, v.descr, true, v.ord, 1, v.kind
FROM (VALUES
  ('Upper o Lower', 'Recovery de tren superior o inferior.', 1, 'doris_ul'),
  ('Full Body', 'Recovery de cuerpo completo.', 2, 'doris_fb')
) AS v(name, descr, ord, kind)
WHERE NOT EXISTS (
  SELECT 1 FROM public.class_types ct WHERE ct.module_key = 'rehabilitacion' AND ct.name = v.name
);

-- Qué crédito pide una clase: el de su tipo; si no tiene, por programa.
-- 'doris_any' = sesión del consultorio sin tipo: sirve cualquier crédito de
-- DorisFisio y la sesión queda del tipo del crédito que se usó.
CREATE OR REPLACE FUNCTION public.class_credit_kind(_class_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(
    ct.credit_kind,
    CASE WHEN c.module_key = 'rehabilitacion' THEN 'doris_any' ELSE 'general' END
  )
  FROM public.classes c
  LEFT JOIN public.class_types ct ON ct.id = c.class_type_id
  WHERE c.id = _class_id
$function$;

CREATE OR REPLACE FUNCTION public.token_balance_kind(_user_id uuid, _kind text)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(sum(remaining), 0)::int FROM public.credit_lots
  WHERE user_id = _user_id AND remaining > 0 AND (expires_at IS NULL OR expires_at > now())
    AND (credit_kind = _kind OR (_kind = 'doris_any' AND credit_kind IN ('doris_ul', 'doris_fb')))
$function$;

-- Créditos vigentes por tipo (para mostrarlos separados).
CREATE OR REPLACE FUNCTION public.credit_balances(_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR (auth.uid() <> _user_id
     AND NOT (public.has_role(auth.uid(), 'admin') OR public.is_staff(auth.uid()))) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  RETURN jsonb_build_object(
    'general', public.token_balance_kind(_user_id, 'general'),
    'doris_ul', public.token_balance_kind(_user_id, 'doris_ul'),
    'doris_fb', public.token_balance_kind(_user_id, 'doris_fb')
  );
END;
$function$;

-- Crédito concreto que se usará: para 'doris_any', el de DorisFisio que vence primero.
CREATE OR REPLACE FUNCTION public.pick_credit_kind(_user_id uuid, _required text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN _required <> 'doris_any' THEN _required ELSE coalesce((
    SELECT l.credit_kind FROM public.credit_lots l
    WHERE l.user_id = _user_id AND l.remaining > 0
      AND (l.expires_at IS NULL OR l.expires_at > now())
      AND l.credit_kind IN ('doris_ul', 'doris_fb')
    ORDER BY l.expires_at NULLS LAST, l.created_at
    LIMIT 1
  ), 'doris_any') END
$function$;

CREATE OR REPLACE FUNCTION public.insufficient_credit_code(_required text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE _required
    WHEN 'doris_ul' THEN 'INSUFFICIENT_TOKENS_UPPER_LOWER'
    WHEN 'doris_fb' THEN 'INSUFFICIENT_TOKENS_FULL_BODY'
    WHEN 'doris_any' THEN 'INSUFFICIENT_TOKENS_DORIS'
    ELSE 'INSUFFICIENT_TOKENS' END
$function$;

-- Los créditos que vienen de una compra toman el tipo del paquete.
CREATE OR REPLACE FUNCTION public.trg_ledger_kind()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.transaction_id IS NOT NULL THEN
    SELECT coalesce(p.credit_kind, 'general') INTO NEW.credit_kind
      FROM public.transactions t LEFT JOIN public.token_plans p ON p.id = t.plan_id
     WHERE t.id = NEW.transaction_id;
    NEW.credit_kind := coalesce(NEW.credit_kind, 'general');
  END IF;
  RETURN NEW;
END; $function$;

DROP TRIGGER IF EXISTS ledger_kind ON public.token_ledger;
CREATE TRIGGER ledger_kind BEFORE INSERT ON public.token_ledger
  FOR EACH ROW EXECUTE FUNCTION public.trg_ledger_kind();

-- Lotes de créditos: cada movimiento solo toca lotes de su mismo tipo.
CREATE OR REPLACE FUNCTION public.trg_ledger_to_lots()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _need int; _lot record; _take int; _days int; _plan text; _from timestamptz; _purchase timestamptz; _start timestamptz;
BEGIN
 IF NEW.delta=0 THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('lots:' || NEW.user_id::text,0));
 IF NEW.delta>0 THEN
  IF NEW.transaction_id IS NOT NULL THEN
   SELECT p.validity_days,p.name,p.membership_starts_at,t.created_at INTO _days,_plan,_from,_purchase FROM public.transactions t LEFT JOIN public.token_plans p ON p.id=t.plan_id WHERE t.id=NEW.transaction_id;
   _start := public.purchase_validity_start(coalesce(_purchase,NEW.created_at),_from);
   INSERT INTO public.credit_lots(user_id,transaction_id,label,granted,remaining,starts_at,expires_at,credit_kind)
   VALUES(NEW.user_id,NEW.transaction_id,coalesce(_plan,NEW.reason),NEW.delta,NEW.delta,_start,CASE WHEN _days IS NOT NULL THEN public.membership_end(_start,_days) END,NEW.credit_kind);
   RETURN NEW;
  END IF;
  _need := NEW.delta;
  FOR _lot IN SELECT * FROM public.credit_lots WHERE user_id=NEW.user_id AND credit_kind=NEW.credit_kind AND remaining<granted AND (expires_at IS NULL OR expires_at>now()) ORDER BY expires_at NULLS LAST,created_at FOR UPDATE LOOP
   EXIT WHEN _need<=0;
   _take := least(_need,_lot.granted-_lot.remaining);
   UPDATE public.credit_lots SET remaining=remaining+_take WHERE id=_lot.id;
   _need := _need-_take;
  END LOOP;
  IF _need>0 THEN
   INSERT INTO public.credit_lots(user_id,label,granted,remaining,starts_at,credit_kind) VALUES(NEW.user_id,NEW.reason,_need,_need,public.purchase_validity_start(NEW.created_at),NEW.credit_kind);
  END IF;
 ELSE
  _need := -NEW.delta;
  FOR _lot IN SELECT * FROM public.credit_lots WHERE user_id=NEW.user_id AND credit_kind=NEW.credit_kind AND remaining>0 AND (expires_at IS NULL OR expires_at>now()) ORDER BY expires_at NULLS LAST,created_at FOR UPDATE LOOP
   EXIT WHEN _need<=0;
   _take := least(_need,_lot.remaining);
   UPDATE public.credit_lots SET remaining=remaining-_take WHERE id=_lot.id;
   _need := _need-_take;
  END LOOP;
 END IF;
 RETURN NEW;
END; $function$;

-- ---------------------------------------------------------------------------
-- 2. Reservas, cancelaciones y devoluciones respetan el tipo de crédito
-- ---------------------------------------------------------------------------
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
    -- El consultorio siempre se paga con su crédito; la membresía no aplica.
    _kind := public.pick_credit_kind(_uid, _need);
    _cost := greatest(_c.tokens_cost, 1);
  END IF;
  IF _cost > 0 AND public.token_balance_kind(_uid, _kind) < _cost THEN
    RAISE EXCEPTION '%', public.insufficient_credit_code(_need);
  END IF;
  INSERT INTO public.bookings (user_id, class_id, tokens_spent, seat_number, credit_kind) VALUES (_uid, _class_id, _cost, _seat, _kind)
    ON CONFLICT (user_id, class_id) DO UPDATE SET status = 'reservada', tokens_spent = _cost, seat_number = _seat, credit_kind = _kind
    RETURNING * INTO _b;
  IF _cost > 0 THEN
    INSERT INTO public.token_ledger (user_id, delta, reason, credit_kind) VALUES (_uid, -_cost, 'Reserva de clase', _kind);
  END IF;
  RETURN _b;
END; $function$;

CREATE OR REPLACE FUNCTION public.admin_book_class(_user_id uuid, _class_id uuid, _seat integer DEFAULT NULL::integer)
 RETURNS bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _c public.classes; _b public.bookings; _taken int; _seat int := _seat; _cost int; _need text; _kind text;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.is_staff(auth.uid())) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO _c FROM public.classes WHERE id = _class_id AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'CLASS_NOT_FOUND'; END IF;
  -- Recovery solo aparta sesiones de su consultorio.
  IF public.is_recovery(auth.uid()) AND NOT public.has_role(auth.uid(), 'admin')
     AND coalesce(_c.module_key, '') <> 'rehabilitacion' THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  SELECT count(*) INTO _taken FROM public.bookings WHERE class_id = _class_id AND status = 'reservada';
  IF _taken >= _c.capacity THEN RAISE EXCEPTION 'CLASS_FULL'; END IF;
  IF EXISTS (SELECT 1 FROM public.bookings WHERE class_id = _class_id AND user_id = _user_id AND status = 'reservada') THEN RAISE EXCEPTION 'ALREADY_BOOKED'; END IF;
  IF _seat IS NOT NULL AND EXISTS (SELECT 1 FROM public.bookings WHERE class_id = _class_id AND seat_number = _seat AND status = 'reservada') THEN RAISE EXCEPTION 'SEAT_TAKEN'; END IF;
  IF _seat IS NULL THEN
    SELECT MIN(s) INTO _seat FROM generate_series(1, _c.capacity) s
      WHERE s NOT IN (SELECT seat_number FROM public.bookings WHERE class_id = _class_id AND status = 'reservada' AND seat_number IS NOT NULL);
  END IF;
  _need := public.class_credit_kind(_class_id);
  IF _need = 'general' THEN
    _kind := 'general';
    _cost := CASE WHEN public.user_daily_class_limit(_user_id, _c.starts_at) IS NOT NULL THEN 0 ELSE _c.tokens_cost END;
  ELSE
    _kind := public.pick_credit_kind(_user_id, _need);
    _cost := greatest(_c.tokens_cost, 1);
  END IF;
  IF _cost > 0 AND public.token_balance_kind(_user_id, _kind) < _cost THEN
    RAISE EXCEPTION '%', public.insufficient_credit_code(_need);
  END IF;
  INSERT INTO public.bookings (user_id, class_id, tokens_spent, seat_number, credit_kind) VALUES (_user_id, _class_id, _cost, _seat, _kind)
    ON CONFLICT (user_id, class_id) DO UPDATE SET status = 'reservada', tokens_spent = _cost, seat_number = _seat, credit_kind = _kind
    RETURNING * INTO _b;
  IF _cost > 0 THEN
    INSERT INTO public.token_ledger (user_id, delta, reason, created_by, credit_kind) VALUES (_user_id, -_cost, 'Reserva registrada por staff', auth.uid(), _kind);
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
  INSERT INTO public.bookings (user_id, class_id, tokens_spent, status, waitlisted_at, credit_kind)
    VALUES (_uid, _class_id, _cost, 'lista_espera', now(), _kind)
    ON CONFLICT (user_id, class_id) DO UPDATE SET status = 'lista_espera', tokens_spent = _cost, waitlisted_at = now(), credit_kind = _kind
    RETURNING * INTO _b;
  INSERT INTO public.token_ledger (user_id, delta, reason, credit_kind) VALUES (_uid, -_cost, 'Lista de espera', _kind);
  RETURN _b;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_booking(_booking_id uuid)
 RETURNS bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    insert into public.token_ledger (user_id, delta, reason, credit_kind)
      values (_b.user_id, _b.tokens_spent, 'Cancelación con reembolso', _b.credit_kind);
  elsif _hours_left < 2 and public.has_active_membership(_b.user_id) then
    insert into public.membership_fees (user_id, booking_id, amount_cents, reason)
      values (_b.user_id, _b.id, 15000, 'Cancelación con menos de 2 horas de anticipación');
  end if;

  return _b;
end; $function$;

CREATE OR REPLACE FUNCTION public.leave_waitlist(_booking_id uuid)
 RETURNS bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _b public.bookings;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO _b FROM public.bookings WHERE id = _booking_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND'; END IF;
  IF _b.user_id <> _uid AND NOT public.has_role(_uid, 'admin') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF _b.status <> 'lista_espera' THEN RAISE EXCEPTION 'NOT_WAITLISTED'; END IF;
  UPDATE public.bookings SET status = 'cancelada' WHERE id = _booking_id RETURNING * INTO _b;
  INSERT INTO public.token_ledger (user_id, delta, reason, credit_kind) VALUES (_b.user_id, _b.tokens_spent, 'Salió de lista de espera', _b.credit_kind);
  RETURN _b;
END;
$function$;

-- Antes cualquiera podía llamarla; ahora solo el equipo.
CREATE OR REPLACE FUNCTION public.refund_booking_credit(p_booking_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_booking public.bookings%ROWTYPE;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.is_staff(auth.uid())) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_booking.tokens_spent > 0 THEN
    INSERT INTO public.token_ledger (user_id, delta, reason, created_by, credit_kind)
    VALUES (v_booking.user_id, v_booking.tokens_spent, p_reason, auth.uid(), v_booking.credit_kind);
  END IF;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.refund_booking_credit(uuid, text) FROM anon;

DROP FUNCTION IF EXISTS public.admin_adjust_tokens(uuid, integer, text);
CREATE OR REPLACE FUNCTION public.admin_adjust_tokens(_user_id uuid, _delta integer, _reason text, _credit_kind text DEFAULT 'general')
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.has_role(auth.uid(),'admin') then raise exception 'FORBIDDEN'; end if;
  insert into public.token_ledger (user_id, delta, reason, created_by, credit_kind)
    values (_user_id, _delta, coalesce(_reason,'Ajuste manual'), auth.uid(), coalesce(_credit_kind, 'general'));
  return public.token_balance_kind(_user_id, coalesce(_credit_kind, 'general'));
end; $function$;
REVOKE EXECUTE ON FUNCTION public.admin_adjust_tokens(uuid, integer, text, text) FROM anon;

-- ---------------------------------------------------------------------------
-- 3. Rol recovery
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_recovery(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.staff_profiles
    WHERE user_id = _user_id AND active AND role = 'recovery'
  )
$function$;

CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.staff_profiles
    where user_id = _user_id and active
      and role in ('admin','staff','coach','recovery')
  )
$function$;

CREATE OR REPLACE FUNCTION public.set_schedule_slot_block(_module_key text, _day date, _start_time text, _blocked boolean)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _time time := _start_time::time;
  _real time;
  _class_id uuid;
  _b record;
  _cancelled int := 0;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin')
          OR (public.has_role(auth.uid(), 'staff') AND public.is_staff(auth.uid()))
          OR (public.is_recovery(auth.uid()) AND _module_key = 'rehabilitacion')) THEN
    RAISE EXCEPTION 'Solo administración puede bloquear horarios';
  END IF;

  SELECT t.actual_start INTO _real FROM public.schedule_templates t
  WHERE t.module_key = _module_key
    AND t.month = date_trunc('month', _day)::date
    AND t.weekday = EXTRACT(ISODOW FROM _day)::int - 1
    AND t.start_time = _time
  LIMIT 1;
  _real := coalesce(_real, _time);

  SELECT id INTO _class_id FROM public.classes
  WHERE module_key = _module_key
    AND (starts_at AT TIME ZONE 'America/Monterrey')::date = _day
    AND (starts_at AT TIME ZONE 'America/Monterrey')::time IN (_real, _time)
  ORDER BY active DESC, created_at
  LIMIT 1;

  IF _blocked THEN
    INSERT INTO public.schedule_slot_blocks (module_key, day, start_time, created_by)
      VALUES (_module_key, _day, _time, auth.uid())
      ON CONFLICT (module_key, day, start_time) DO NOTHING;

    IF _class_id IS NOT NULL THEN
      FOR _b IN
        SELECT id, user_id, tokens_spent, credit_kind FROM public.bookings
        WHERE class_id = _class_id AND status IN ('reservada', 'lista_espera')
      LOOP
        UPDATE public.bookings SET status = 'cancelada' WHERE id = _b.id;
        IF _b.tokens_spent > 0 THEN
          INSERT INTO public.token_ledger (user_id, delta, reason, created_by, credit_kind)
            VALUES (_b.user_id, _b.tokens_spent, 'Clase cancelada por el estudio', auth.uid(), _b.credit_kind);
        END IF;
        _cancelled := _cancelled + 1;
      END LOOP;
      UPDATE public.classes SET active = false WHERE id = _class_id;
    END IF;
  ELSE
    DELETE FROM public.schedule_slot_blocks
      WHERE module_key = _module_key AND day = _day AND start_time = _time;
    IF _class_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.schedule_blackouts WHERE module_key = _module_key AND day = _day
    ) THEN
      UPDATE public.classes SET active = true WHERE id = _class_id;
    END IF;
  END IF;

  RETURN _cancelled;
END;
$function$;

-- Programar / copiar mes: recovery solo en su consultorio.
DO $migration$
DECLARE
  fn text;
  v_def text;
  v_old constant text := '(public.has_role(auth.uid(), ''staff'') AND public.is_staff(auth.uid()))';
  v_new constant text := '(public.has_role(auth.uid(), ''staff'') AND public.is_staff(auth.uid())) OR (public.is_recovery(auth.uid()) AND _module_key = ''rehabilitacion'')';
BEGIN
  FOREACH fn IN ARRAY ARRAY['public.publish_schedule_range(text,date,date)', 'public.copy_schedule_month(text,date,date)'] LOOP
    v_def := pg_get_functiondef(fn::regprocedure);
    IF position('is_recovery' IN v_def) = 0 THEN
      IF position(v_old IN v_def) = 0 THEN
        RAISE EXCEPTION 'No se encontró la validación de permisos en %', fn;
      END IF;
      EXECUTE replace(v_def, v_old, v_new);
    END IF;
  END LOOP;
END
$migration$;

-- Reembolsos del mostrador: los créditos que se quitan son del tipo del paquete.
DO $migration$
DECLARE
  v_def text;
  v_kind constant text := 'coalesce((SELECT p.credit_kind FROM public.transactions t JOIN public.token_plans p ON p.id = t.plan_id WHERE (_kind = ''terminal'' AND t.external_ref LIKE ''pinpad\_'' || _id::text || ''\_%'') OR (_kind = ''transaction'' AND t.id = _id) LIMIT 1), ''general'')';
BEGIN
  v_def := pg_get_functiondef('public.pos_refund_preview(text,uuid)'::regprocedure);
  IF position('token_balance_kind' IN v_def) = 0 THEN
    IF position('greatest(public.token_balance(_user), 0)' IN v_def) = 0 THEN
      RAISE EXCEPTION 'pos_refund_preview cambió; revisar migración';
    END IF;
    EXECUTE replace(v_def, 'greatest(public.token_balance(_user), 0)',
      'greatest(public.token_balance_kind(_user, ' || v_kind || '), 0)');
  END IF;

  v_def := pg_get_functiondef('public.pos_apply_refund(text,uuid,text,text,uuid)'::regprocedure);
  IF position('credit_kind' IN v_def) = 0 THEN
    IF position('INSERT INTO public.token_ledger (user_id, delta, reason, created_by)' IN v_def) = 0 THEN
      RAISE EXCEPTION 'pos_apply_refund cambió; revisar migración';
    END IF;
    v_def := replace(v_def, 'INSERT INTO public.token_ledger (user_id, delta, reason, created_by)',
      'INSERT INTO public.token_ledger (user_id, delta, reason, created_by, credit_kind)');
    v_def := replace(v_def, 'VALUES (_user, -_to_remove, _tag, _by_user);',
      'VALUES (_user, -_to_remove, _tag, _by_user, ' || v_kind || ');');
    EXECUTE v_def;
  END IF;
END
$migration$;

-- Consultas de DorisFisio: cada sesión con su tipo y precio del paquete.
CREATE OR REPLACE FUNCTION public.recovery_sessions(_from date, _to date)
 RETURNS TABLE(booking_id uuid, starts_at timestamptz, client_name text, client_email text, credit_kind text, status text, checked_in boolean, price_cents integer, class_type text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.is_recovery(auth.uid())) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  RETURN QUERY
  SELECT b.id, c.starts_at,
         coalesce(nullif(p.full_name, ''), p.email, 'Cliente')::text,
         coalesce(p.email, '')::text,
         b.credit_kind,
         b.status::text,
         EXISTS (SELECT 1 FROM public.check_ins ci WHERE ci.booking_id = b.id AND ci.status <> 'no_show'),
         CASE WHEN b.credit_kind IN ('doris_ul', 'doris_fb') THEN
           coalesce((SELECT tp.price_cents / greatest(tp.tokens, 1) FROM public.token_plans tp
                      WHERE tp.credit_kind = b.credit_kind AND tp.tokens > 0
                      ORDER BY tp.active DESC, tp.sort_order, tp.created_at LIMIT 1), 0)
         ELSE 0 END::int,
         ct.name::text
  FROM public.bookings b
  JOIN public.classes c ON c.id = b.class_id
  LEFT JOIN public.class_types ct ON ct.id = c.class_type_id
  LEFT JOIN public.profiles p ON p.id = b.user_id
  WHERE c.module_key = 'rehabilitacion'
    AND b.status = 'reservada'
    AND (c.starts_at AT TIME ZONE 'America/Monterrey')::date BETWEEN _from AND _to
  ORDER BY c.starts_at;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.recovery_sessions(date, date) FROM anon;

-- Políticas para recovery (solo su consultorio y lectura de clientes).
DROP POLICY IF EXISTS recovery_schedule_templates_write ON public.schedule_templates;
CREATE POLICY recovery_schedule_templates_write ON public.schedule_templates FOR ALL TO authenticated
  USING (public.is_recovery(auth.uid()) AND module_key = 'rehabilitacion')
  WITH CHECK (public.is_recovery(auth.uid()) AND module_key = 'rehabilitacion');

DROP POLICY IF EXISTS recovery_schedule_blackouts_write ON public.schedule_blackouts;
CREATE POLICY recovery_schedule_blackouts_write ON public.schedule_blackouts FOR ALL TO authenticated
  USING (public.is_recovery(auth.uid()) AND module_key = 'rehabilitacion')
  WITH CHECK (public.is_recovery(auth.uid()) AND module_key = 'rehabilitacion');

DROP POLICY IF EXISTS recovery_class_types_write ON public.class_types;
CREATE POLICY recovery_class_types_write ON public.class_types FOR ALL TO authenticated
  USING (public.is_recovery(auth.uid()) AND module_key = 'rehabilitacion')
  WITH CHECK (public.is_recovery(auth.uid()) AND module_key = 'rehabilitacion');

DROP POLICY IF EXISTS recovery_site_module_update ON public.site_modules;
CREATE POLICY recovery_site_module_update ON public.site_modules FOR UPDATE TO authenticated
  USING (public.is_recovery(auth.uid()) AND key = 'rehabilitacion')
  WITH CHECK (public.is_recovery(auth.uid()) AND key = 'rehabilitacion');

DROP POLICY IF EXISTS recovery_staff_directory_read ON public.staff_profiles;
CREATE POLICY recovery_staff_directory_read ON public.staff_profiles FOR SELECT TO authenticated
  USING (public.is_recovery(auth.uid()));

DROP POLICY IF EXISTS recovery_profiles_read ON public.profiles;
CREATE POLICY recovery_profiles_read ON public.profiles FOR SELECT TO authenticated
  USING (public.is_recovery(auth.uid())
         AND NOT EXISTS (SELECT 1 FROM public.staff_profiles s WHERE s.user_id = profiles.id));

DROP POLICY IF EXISTS recovery_client_ledger_read ON public.token_ledger;
CREATE POLICY recovery_client_ledger_read ON public.token_ledger FOR SELECT TO authenticated
  USING (public.is_recovery(auth.uid())
         AND NOT EXISTS (SELECT 1 FROM public.staff_profiles s WHERE s.user_id = token_ledger.user_id));

DROP POLICY IF EXISTS recovery_client_transactions_read ON public.transactions;
CREATE POLICY recovery_client_transactions_read ON public.transactions FOR SELECT TO authenticated
  USING (public.is_recovery(auth.uid())
         AND NOT EXISTS (SELECT 1 FROM public.staff_profiles s WHERE s.user_id = transactions.user_id));

DROP POLICY IF EXISTS recovery_client_waivers_read ON public.waiver_signatures;
CREATE POLICY recovery_client_waivers_read ON public.waiver_signatures FOR SELECT TO authenticated
  USING (public.is_recovery(auth.uid()));

DROP POLICY IF EXISTS recovery_plans_read ON public.token_plans;
CREATE POLICY recovery_plans_read ON public.token_plans FOR SELECT TO authenticated
  USING (public.is_recovery(auth.uid()) AND credit_kind IN ('doris_ul', 'doris_fb'));

DROP POLICY IF EXISTS recovery_plans_update ON public.token_plans;
CREATE POLICY recovery_plans_update ON public.token_plans FOR UPDATE TO authenticated
  USING (public.is_recovery(auth.uid()) AND credit_kind IN ('doris_ul', 'doris_fb'))
  WITH CHECK (public.is_recovery(auth.uid()) AND credit_kind IN ('doris_ul', 'doris_fb'));

-- Doris pasa de coach a recovery.
UPDATE public.staff_profiles SET role = 'recovery' WHERE id = 'bc06a330-e57b-48e2-a253-d6cedb5ee055';
DELETE FROM public.user_roles WHERE user_id = 'e15e96d5-22bb-481f-8fa1-6a9b3297fe22' AND role = 'coach';
INSERT INTO public.user_roles (user_id, role) VALUES ('e15e96d5-22bb-481f-8fa1-6a9b3297fe22', 'recovery')
  ON CONFLICT (user_id, role) DO NOTHING;
