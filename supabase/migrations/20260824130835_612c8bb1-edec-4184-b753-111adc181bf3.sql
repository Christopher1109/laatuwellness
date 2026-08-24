ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS admin_notes text NOT NULL DEFAULT '';

REVOKE ALL ON FUNCTION public.log_activity(text, text, text, uuid, text, uuid, integer, jsonb) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.person_label(uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_log_transaction() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_log_token_ledger() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_log_booking() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_log_checkin() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_log_pos_sale() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_log_inventory() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_log_product() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_log_class() FROM anon, authenticated;