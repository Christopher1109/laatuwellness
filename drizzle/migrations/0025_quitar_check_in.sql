-- Quitar una marca de check-in (a tiempo, tarde o no-show) cuando se picó por
-- error: la persona vuelve a quedar "pendiente". Si era no-show y se había
-- generado el cargo por no-show de membresía que aún no se cobra, se cancela;
-- si ya se cobró, se deja como está (eso se resuelve con un reembolso).
CREATE OR REPLACE FUNCTION public.clear_check_in(_booking_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _ci public.check_ins;
BEGIN
  IF NOT (public.is_staff(auth.uid()) OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  DELETE FROM public.check_ins WHERE booking_id = _booking_id RETURNING * INTO _ci;
  IF NOT FOUND THEN RETURN false; END IF;
  IF _ci.status = 'no_show' THEN
    DELETE FROM public.membership_fees
     WHERE booking_id = _booking_id AND status = 'pending_charge' AND charged_at IS NULL;
  END IF;
  RETURN true;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.clear_check_in(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.clear_check_in(uuid) TO authenticated;
