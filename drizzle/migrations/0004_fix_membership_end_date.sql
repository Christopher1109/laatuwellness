CREATE OR REPLACE FUNCTION public.membership_end(_start timestamptz, _days int)
RETURNS timestamptz LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT (((_start AT TIME ZONE 'America/Monterrey')::date + _days) + time '23:59:59') AT TIME ZONE 'America/Monterrey'
$$;
UPDATE public.transactions t SET access_ends_at = public.membership_end(t.access_starts_at, coalesce(p.validity_days, 30))
FROM public.token_plans p WHERE p.id = t.plan_id AND p.daily_class_limit IS NOT NULL AND t.access_starts_at IS NOT NULL;