REVOKE EXECUTE ON FUNCTION public.purchase_plan(uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_plan(uuid, text) TO service_role;