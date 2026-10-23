CREATE POLICY reception_profiles_read ON public.profiles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'staff') AND public.is_staff(auth.uid()) AND NOT EXISTS (SELECT 1 FROM public.staff_profiles s WHERE s.user_id = profiles.id));
CREATE POLICY reception_staff_directory_read ON public.staff_profiles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'staff') AND public.is_staff(auth.uid()));
CREATE POLICY reception_client_ledger_read ON public.token_ledger FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'staff') AND public.is_staff(auth.uid()) AND NOT EXISTS (SELECT 1 FROM public.staff_profiles s WHERE s.user_id = token_ledger.user_id));
CREATE POLICY reception_client_transactions_read ON public.transactions FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'staff') AND public.is_staff(auth.uid()) AND NOT EXISTS (SELECT 1 FROM public.staff_profiles s WHERE s.user_id = transactions.user_id));
CREATE POLICY reception_client_waivers_read ON public.waiver_signatures FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'staff') AND public.is_staff(auth.uid()));
CREATE POLICY reception_schedule_templates_write ON public.schedule_templates FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'staff') AND public.is_staff(auth.uid())) WITH CHECK (public.has_role(auth.uid(), 'staff') AND public.is_staff(auth.uid()));
CREATE POLICY reception_schedule_blackouts_write ON public.schedule_blackouts FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'staff') AND public.is_staff(auth.uid())) WITH CHECK (public.has_role(auth.uid(), 'staff') AND public.is_staff(auth.uid()));
DO $migration$
DECLARE v_function text; v_oid oid;
BEGIN
  FOR v_oid IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('publish_schedule_range', 'copy_schedule_month', 'set_schedule_slot_block') LOOP
    v_function := pg_get_functiondef(v_oid);
    v_function := replace(v_function, 'IF NOT public.has_role(auth.uid(), ''admin'') THEN', 'IF NOT (public.has_role(auth.uid(), ''admin'') OR (public.has_role(auth.uid(), ''staff'') AND public.is_staff(auth.uid()))) THEN');
    EXECUTE v_function;
  END LOOP;
END $migration$;