-- Clientes de DorisFisio ordenados por actividad reciente en el consultorio:
-- compra o alta de créditos de DorisFisio, reservas y sesiones. Quien no tiene
-- actividad con DorisFisio queda abajo, por nombre.
DROP FUNCTION IF EXISTS public.recovery_clients();
CREATE FUNCTION public.recovery_clients()
 RETURNS TABLE(id uuid, full_name text, email text, phone text, created_at timestamptz, doris_ul integer, doris_fb integer, last_session timestamptz, next_session timestamptz, last_activity timestamptz)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.is_recovery(auth.uid())) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  RETURN QUERY
  WITH base AS (
    SELECT p.id,
           coalesce(p.full_name, '')::text AS full_name,
           coalesce(p.email, '')::text AS email,
           p.phone::text AS phone,
           p.created_at,
           public.token_balance_kind(p.id, 'doris_ul') AS doris_ul,
           public.token_balance_kind(p.id, 'doris_fb') AS doris_fb,
           (SELECT max(c.starts_at) FROM public.bookings b JOIN public.classes c ON c.id = b.class_id
             WHERE b.user_id = p.id AND b.status = 'reservada' AND c.module_key = 'rehabilitacion' AND c.starts_at <= now()) AS last_session,
           (SELECT min(c.starts_at) FROM public.bookings b JOIN public.classes c ON c.id = b.class_id
             WHERE b.user_id = p.id AND b.status = 'reservada' AND c.module_key = 'rehabilitacion' AND c.starts_at > now()) AS next_session,
           greatest(
             (SELECT max(l.created_at) FROM public.token_ledger l
               WHERE l.user_id = p.id AND l.credit_kind IN ('doris_ul', 'doris_fb')),
             (SELECT max(b.created_at) FROM public.bookings b JOIN public.classes c ON c.id = b.class_id
               WHERE b.user_id = p.id AND c.module_key = 'rehabilitacion'),
             (SELECT max(c.starts_at) FROM public.bookings b JOIN public.classes c ON c.id = b.class_id
               WHERE b.user_id = p.id AND b.status = 'reservada' AND c.module_key = 'rehabilitacion' AND c.starts_at <= now())
           ) AS last_activity
    FROM public.profiles p
    WHERE NOT EXISTS (SELECT 1 FROM public.staff_profiles s WHERE s.user_id = p.id)
  )
  SELECT base.* FROM base
  ORDER BY base.last_activity DESC NULLS LAST,
           lower(coalesce(nullif(base.full_name, ''), base.email));
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.recovery_clients() FROM anon;
