-- Clientes para recovery (DorisFisio): ve a todas las personas con cuenta,
-- pero solo sus créditos de DorisFisio (sin ingresos ni compras), y solo puede
-- AGREGAR créditos de DorisFisio (Upper o Lower / Full Body).

CREATE OR REPLACE FUNCTION public.recovery_clients()
 RETURNS TABLE(id uuid, full_name text, email text, phone text, created_at timestamptz, doris_ul integer, doris_fb integer, last_session timestamptz, next_session timestamptz)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.is_recovery(auth.uid())) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  RETURN QUERY
  SELECT p.id,
         coalesce(p.full_name, '')::text,
         coalesce(p.email, '')::text,
         p.phone::text,
         p.created_at,
         public.token_balance_kind(p.id, 'doris_ul'),
         public.token_balance_kind(p.id, 'doris_fb'),
         (SELECT max(c.starts_at) FROM public.bookings b JOIN public.classes c ON c.id = b.class_id
           WHERE b.user_id = p.id AND b.status = 'reservada' AND c.module_key = 'rehabilitacion' AND c.starts_at <= now()),
         (SELECT min(c.starts_at) FROM public.bookings b JOIN public.classes c ON c.id = b.class_id
           WHERE b.user_id = p.id AND b.status = 'reservada' AND c.module_key = 'rehabilitacion' AND c.starts_at > now())
  FROM public.profiles p
  WHERE NOT EXISTS (SELECT 1 FROM public.staff_profiles s WHERE s.user_id = p.id)
  ORDER BY lower(coalesce(nullif(p.full_name, ''), p.email));
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.recovery_clients() FROM anon;

CREATE OR REPLACE FUNCTION public.recovery_add_credits(_user_id uuid, _credit_kind text, _qty integer, _reason text DEFAULT NULL)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _label text;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.is_recovery(auth.uid())) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF _credit_kind NOT IN ('doris_ul', 'doris_fb') THEN RAISE EXCEPTION 'INVALID_CREDIT_KIND'; END IF;
  IF _qty IS NULL OR _qty < 1 OR _qty > 20 THEN RAISE EXCEPTION 'INVALID_QTY'; END IF;
  IF EXISTS (SELECT 1 FROM public.staff_profiles s WHERE s.user_id = _user_id) THEN
    RAISE EXCEPTION 'NOT_A_CLIENT';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id) THEN
    RAISE EXCEPTION 'NOT_A_CLIENT';
  END IF;
  _label := 'DorisFisio · ' || CASE _credit_kind WHEN 'doris_ul' THEN 'Upper o Lower' ELSE 'Full Body' END
            || coalesce(' · ' || nullif(trim(_reason), ''), '');
  INSERT INTO public.token_ledger (user_id, delta, reason, created_by, credit_kind)
    VALUES (_user_id, _qty, left(_label, 200), auth.uid(), _credit_kind);
  RETURN public.token_balance_kind(_user_id, _credit_kind);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.recovery_add_credits(uuid, text, integer, text) FROM anon;
