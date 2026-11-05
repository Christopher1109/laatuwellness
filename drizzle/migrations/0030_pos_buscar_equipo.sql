-- Punto de venta: recepción puede elegir como cliente a integrantes del
-- equipo (staff o coaches) con su propia cuenta. La lectura directa de
-- perfiles del equipo sigue cerrada; esta búsqueda solo regresa nombre,
-- correo y puesto.
CREATE OR REPLACE FUNCTION public.pos_search_people(_q text)
RETURNS TABLE(id uuid, full_name text, email text, team_role text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _pat text;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin')
          OR (public.has_role(auth.uid(), 'staff') AND public.is_staff(auth.uid()))
          OR public.is_recovery(auth.uid())) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF length(trim(coalesce(_q, ''))) < 2 THEN RETURN; END IF;
  _pat := '%' || replace(replace(replace(trim(_q), '\', '\\'), '%', '\%'), '_', '\_') || '%';

  RETURN QUERY
  SELECT p.id, coalesce(nullif(s.full_name, ''), p.full_name), p.email, s.role::text
    FROM public.profiles p
    LEFT JOIN public.staff_profiles s ON s.user_id = p.id AND s.active
   WHERE p.email ILIKE _pat OR p.full_name ILIKE _pat OR s.full_name ILIKE _pat
   ORDER BY (s.role IS NOT NULL), p.full_name
   LIMIT 8;
END;
$function$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.pos_search_people(text) FROM public, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.pos_search_people(text) TO authenticated;
--> statement-breakpoint

-- Las cuentas del equipo traían nombres de prueba en su perfil; se usa el
-- nombre con el que están dadas de alta en el equipo.
UPDATE public.profiles p
   SET full_name = s.full_name
  FROM public.staff_profiles s
 WHERE s.user_id = p.id AND coalesce(s.full_name, '') <> '' AND p.full_name IS DISTINCT FROM s.full_name;
