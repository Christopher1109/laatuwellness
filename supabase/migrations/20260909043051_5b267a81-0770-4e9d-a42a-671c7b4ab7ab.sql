REVOKE EXECUTE ON FUNCTION public.is_staff(uuid) FROM anon;
DROP POLICY IF EXISTS products_public_read ON public.products;
CREATE POLICY products_anon_read ON public.products FOR SELECT TO anon USING (active);
CREATE POLICY products_auth_read ON public.products FOR SELECT TO authenticated
  USING (active OR has_role(auth.uid(),'admin'::app_role) OR is_staff(auth.uid()));
GRANT SELECT ON public.products TO anon;