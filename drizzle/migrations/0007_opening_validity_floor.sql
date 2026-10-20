CREATE OR REPLACE FUNCTION public.purchase_validity_start(_purchased_at timestamptz, _configured_start timestamptz DEFAULT NULL)
RETURNS timestamptz LANGUAGE sql IMMUTABLE SET search_path = public AS $$
 SELECT greatest(_purchased_at, '2026-10-26 00:00:00 America/Monterrey'::timestamptz, coalesce(_configured_start, '-infinity'::timestamptz))
$$;
GRANT EXECUTE ON FUNCTION public.purchase_validity_start(timestamptz, timestamptz) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.purchase_validity_start(timestamptz, timestamptz) IS 'One-time studio opening floor; purchases from October 26, 2026 onward retain their purchase timestamp.';
ALTER TABLE public.credit_lots ADD COLUMN starts_at timestamptz;
COMMENT ON COLUMN public.credit_lots.starts_at IS 'Validity start, with pre-opening purchases deferred to October 26, 2026 in Monterrey.';
UPDATE public.credit_lots l SET starts_at = public.purchase_validity_start(coalesce(t.created_at,l.created_at), p.membership_starts_at),
 expires_at = CASE WHEN p.validity_days IS NOT NULL THEN public.membership_end(public.purchase_validity_start(coalesce(t.created_at,l.created_at),p.membership_starts_at),p.validity_days) ELSE l.expires_at END
FROM public.transactions t JOIN public.token_plans p ON p.id=t.plan_id
WHERE l.transaction_id=t.id;
UPDATE public.credit_lots SET starts_at=public.purchase_validity_start(created_at),
 expires_at=CASE WHEN expires_at IS NOT NULL AND created_at < '2026-10-26 00:00:00 America/Monterrey'::timestamptz THEN expires_at + (date '2026-10-26' - (created_at AT TIME ZONE 'America/Monterrey')::date) * interval '1 day' ELSE expires_at END
WHERE starts_at IS NULL;
CREATE OR REPLACE FUNCTION public.trg_set_membership_access()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _p public.token_plans; _prev timestamptz; _start timestamptz;
BEGIN
 IF NEW.plan_id IS NULL OR NEW.status <> 'completed' OR NEW.access_ends_at IS NOT NULL THEN RETURN NEW; END IF;
 SELECT * INTO _p FROM public.token_plans WHERE id=NEW.plan_id;
 IF NOT FOUND OR _p.daily_class_limit IS NULL THEN RETURN NEW; END IF;
 IF _p.renews_plan_id IS NOT NULL THEN
  SELECT max(t.access_ends_at) INTO _prev FROM public.transactions t WHERE t.user_id=NEW.user_id AND t.status='completed' AND t.plan_id IN (_p.renews_plan_id,_p.id);
 END IF;
 IF _prev IS NOT NULL AND _prev > now() - interval '1 day' THEN
  NEW.access_starts_at := _prev + interval '1 second';
  NEW.access_ends_at := public.membership_end(NEW.access_starts_at,coalesce(_p.validity_days,180));
 ELSE
  _start := public.purchase_validity_start(coalesce(NEW.created_at,now()),_p.membership_starts_at);
  NEW.access_starts_at := _start;
  NEW.access_ends_at := public.membership_end(_start,coalesce(_p.validity_days,30));
 END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION public.trg_ledger_to_lots()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _need int; _lot record; _take int; _days int; _plan text; _from timestamptz; _purchase timestamptz; _start timestamptz;
BEGIN
 IF NEW.delta=0 THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('lots:' || NEW.user_id::text,0));
 IF NEW.delta>0 THEN
  IF NEW.transaction_id IS NOT NULL THEN
   SELECT p.validity_days,p.name,p.membership_starts_at,t.created_at INTO _days,_plan,_from,_purchase FROM public.transactions t LEFT JOIN public.token_plans p ON p.id=t.plan_id WHERE t.id=NEW.transaction_id;
   _start := public.purchase_validity_start(coalesce(_purchase,NEW.created_at),_from);
   INSERT INTO public.credit_lots(user_id,transaction_id,label,granted,remaining,starts_at,expires_at)
   VALUES(NEW.user_id,NEW.transaction_id,coalesce(_plan,NEW.reason),NEW.delta,NEW.delta,_start,CASE WHEN _days IS NOT NULL THEN public.membership_end(_start,_days) END);
   RETURN NEW;
  END IF;
  _need := NEW.delta;
  FOR _lot IN SELECT * FROM public.credit_lots WHERE user_id=NEW.user_id AND remaining<granted AND (expires_at IS NULL OR expires_at>now()) ORDER BY expires_at NULLS LAST,created_at FOR UPDATE LOOP
   EXIT WHEN _need<=0;
   _take := least(_need,_lot.granted-_lot.remaining);
   UPDATE public.credit_lots SET remaining=remaining+_take WHERE id=_lot.id;
   _need := _need-_take;
  END LOOP;
  IF _need>0 THEN
   INSERT INTO public.credit_lots(user_id,label,granted,remaining,starts_at) VALUES(NEW.user_id,NEW.reason,_need,_need,public.purchase_validity_start(NEW.created_at));
  END IF;
 ELSE
  _need := -NEW.delta;
  FOR _lot IN SELECT * FROM public.credit_lots WHERE user_id=NEW.user_id AND remaining>0 AND (expires_at IS NULL OR expires_at>now()) ORDER BY expires_at NULLS LAST,created_at FOR UPDATE LOOP
   EXIT WHEN _need<=0;
   _take := least(_need,_lot.remaining);
   UPDATE public.credit_lots SET remaining=remaining-_take WHERE id=_lot.id;
   _need := _need-_take;
  END LOOP;
 END IF;
 RETURN NEW;
END; $$;