-- ============================================================================
-- Membresías (The OGs, Two a Day Your Way, The Everyday) no se cobran solas
-- con Clip -- Clip no tiene API de suscripciones, solo su "Pagos
-- Recurrentes" desde el dashboard, que el staff tiene que configurar a
-- mano por cliente.
--
-- Por eso, en línea, una membresía ya NO dispara un cobro directo: crea una
-- "solicitud" pendiente. El staff ve la solicitud en el admin, inscribe a
-- la persona en Pagos Recurrentes desde el dashboard de Clip, y marca la
-- solicitud como completada -- eso es lo que activa la membresía y da los
-- créditos en Läätu.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.membership_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.token_plans(id),
  status text NOT NULL DEFAULT 'pendiente', -- pendiente | inscrito | cancelado
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  completed_by uuid REFERENCES public.staff_profiles(id),
  notes text
);
CREATE INDEX IF NOT EXISTS membership_requests_status_idx ON public.membership_requests(status);
GRANT SELECT, INSERT ON public.membership_requests TO authenticated;
GRANT ALL ON public.membership_requests TO service_role;
ALTER TABLE public.membership_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "membership_requests_self_insert_select" ON public.membership_requests;
CREATE POLICY "membership_requests_self_insert_select" ON public.membership_requests
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "membership_requests_staff_all" ON public.membership_requests;
CREATE POLICY "membership_requests_staff_all" ON public.membership_requests
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.is_staff(auth.uid()))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.is_staff(auth.uid()));

-- Al marcar una solicitud como inscrita, se le dan los créditos de la
-- membresía en Läätu (asumiendo que el staff ya la dejó corriendo en
-- Pagos Recurrentes de Clip por fuera).
CREATE OR REPLACE FUNCTION public.complete_membership_request(
  _request_id uuid,
  _staff_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id uuid;
  _plan_id uuid;
BEGIN
  SELECT user_id, plan_id INTO _user_id, _plan_id
    FROM public.membership_requests WHERE id = _request_id AND status = 'pendiente';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND_OR_ALREADY_HANDLED';
  END IF;

  PERFORM public.fulfill_plan_purchase(
    _user_id,
    _plan_id,
    'membership_request_' || _request_id::text,
    'tarjeta'
  );

  UPDATE public.membership_requests
    SET status = 'inscrito', completed_at = now(), completed_by = _staff_id
    WHERE id = _request_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.complete_membership_request(uuid, uuid) TO authenticated;
