-- Meet LAATU: una clase de regalo para cada cuenta nueva.
--
-- * Es un paquete (token_plans) marcado como welcome_gift: 1 crédito, $0,
--   oculto de la venta en web, app y punto de venta.
-- * Se asigna solo, una sola vez, en cuanto se crea la cuenta (registro con
--   correo o Google, o alta desde recepción). Queda como transacción
--   'cortesia' de $0, así aparece en el perfil y en finanzas como paquete.
-- * Para pausar la promoción basta con desactivar el paquete en Admin >
--   Paquetes: mientras esté inactivo nadie nuevo lo recibe.
-- * El regalo no cuenta como "compra": quien lo recibió sigue siendo cliente
--   nuevo para Newcomer y para cupones de clientes nuevos.

ALTER TABLE public.token_plans ADD COLUMN IF NOT EXISTS welcome_gift boolean NOT NULL DEFAULT false;
--> statement-breakpoint

INSERT INTO public.token_plans
  (name, subtitle, description, tokens, price_cents, currency, validity_days, active,
   sort_order, category, is_staff_only, purchasable_once, new_clients_only, welcome_gift, credit_kind)
SELECT
  'Meet LAATU',
  'Tu primera clase, de regalo',
  'Crea tu cuenta y recibe una clase gratis para conocer LAATU. Se asigna automáticamente una sola vez por cuenta.',
  1, 0, 'MXN', 30, true,
  0, 'clases_pilates', true, true, false, true, 'general'
WHERE NOT EXISTS (SELECT 1 FROM public.token_plans WHERE welcome_gift);
--> statement-breakpoint

-- ¿La cuenta ya tiene alguna compra real? (ignora el regalo de bienvenida)
CREATE OR REPLACE FUNCTION public.has_paid_purchase(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.transactions t
    LEFT JOIN public.token_plans p ON p.id = t.plan_id
    WHERE t.user_id = _user_id AND t.status = 'completed'
      AND NOT coalesce(p.welcome_gift, false)
  )
$function$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.has_paid_purchase(uuid) FROM public, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.has_paid_purchase(uuid) TO authenticated, service_role;
--> statement-breakpoint

-- Asigna Meet LAATU a una cuenta (idempotente: la referencia es única por
-- cuenta y el paquete es de compra única). Devuelve true si lo asignó ahora.
CREATE OR REPLACE FUNCTION public.grant_welcome_gift(_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _p public.token_plans;
BEGIN
  IF _user_id IS NULL THEN RETURN false; END IF;
  -- Cuentas del equipo no reciben el regalo.
  IF EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = _user_id) THEN RETURN false; END IF;

  SELECT * INTO _p FROM public.token_plans
   WHERE welcome_gift AND active
   ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RETURN false; END IF;

  IF EXISTS (
    SELECT 1 FROM public.transactions t JOIN public.token_plans p ON p.id = t.plan_id
    WHERE t.user_id = _user_id AND p.welcome_gift
  ) THEN
    RETURN false;
  END IF;

  PERFORM public.fulfill_plan_purchase(_user_id, _p.id, 'welcome_gift_' || _user_id::text, 'cortesia');
  RETURN true;
END;
$function$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.grant_welcome_gift(uuid) FROM public, anon, authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.grant_welcome_gift(uuid) TO service_role;
--> statement-breakpoint

-- Alta de cuenta: igual que antes + regalo de bienvenida. Si algo falla con
-- el regalo, la cuenta se crea de todos modos.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare _staff public.staff_profiles;
begin
  insert into public.profiles (id, full_name, email, phone)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''), coalesce(new.email,''), new.raw_user_meta_data->>'phone')
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

-- El regalo nunca se vende y no cuenta como compra para "solo clientes nuevos".
CREATE OR REPLACE FUNCTION public.plan_purchase_block_reason(_user_id uuid, _plan_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _p public.token_plans; _latest timestamptz;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> _user_id
     AND NOT (public.has_role(auth.uid(), 'admin') OR public.is_staff(auth.uid())) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  SELECT * INTO _p FROM public.token_plans WHERE id = _plan_id;
  IF NOT FOUND OR NOT _p.active OR _p.welcome_gift THEN RETURN 'PLAN_NOT_AVAILABLE'; END IF;
  IF _p.renews_plan_id IS NOT NULL THEN
    SELECT max(t.access_ends_at) INTO _latest FROM public.transactions t
     WHERE t.user_id = _user_id AND t.status = 'completed' AND t.plan_id IN (_p.renews_plan_id, _p.id);
    IF _latest IS NULL THEN RETURN 'RENEWAL_NOT_ELIGIBLE'; END IF;
    IF _latest < now() THEN RETURN 'RENEWAL_EXPIRED'; END IF;
    IF _latest > now() + interval '5 days' THEN RETURN 'RENEWAL_TOO_EARLY'; END IF;
    RETURN NULL;
  END IF;
  IF _p.available_from IS NOT NULL AND now() < _p.available_from THEN RETURN 'PLAN_NOT_YET_AVAILABLE'; END IF;
  IF _p.available_until IS NOT NULL AND now() > _p.available_until THEN RETURN 'PLAN_EXPIRED'; END IF;
  IF _p.max_sales IS NOT NULL AND public.plan_sales_count(_plan_id) >= _p.max_sales THEN RETURN 'PLAN_SOLD_OUT'; END IF;
  IF _p.purchasable_once AND EXISTS (
    SELECT 1 FROM public.transactions WHERE user_id = _user_id AND plan_id = _plan_id AND status = 'completed'
  ) THEN RETURN 'PLAN_ALREADY_PURCHASED'; END IF;
  IF _p.new_clients_only AND public.has_paid_purchase(_user_id) THEN RETURN 'NEW_CLIENTS_ONLY'; END IF;
  RETURN NULL;
END; $function$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.redeem_coupon(_code text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _c public.coupons;
  _mine int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  SELECT * INTO _c FROM public.coupons
    WHERE upper(code) = upper(trim(_code)) AND active
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'COUPON_NOT_FOUND'; END IF;

  IF _c.max_uses IS NOT NULL AND _c.times_used >= _c.max_uses THEN
    RAISE EXCEPTION 'COUPON_EXHAUSTED';
  END IF;

  SELECT count(*) INTO _mine FROM public.coupon_redemptions
    WHERE coupon_id = _c.id AND user_id = _uid;
  IF _c.max_uses_per_user IS NOT NULL AND _mine >= _c.max_uses_per_user THEN
    RAISE EXCEPTION 'COUPON_ALREADY_USED';
  END IF;

  IF _c.new_clients_only AND public.has_paid_purchase(_uid) THEN
    RAISE EXCEPTION 'COUPON_NEW_CLIENTS_ONLY';
  END IF;

  INSERT INTO public.coupon_redemptions (coupon_id, user_id) VALUES (_c.id, _uid);
  UPDATE public.coupons SET times_used = times_used + 1 WHERE id = _c.id;
  INSERT INTO public.token_ledger (user_id, delta, reason)
    VALUES (_uid, _c.reward_tokens, 'Cupón: ' || _c.code);

  RETURN _c.reward_tokens;
END;
$function$;
