-- La lista "Ventas recientes y reembolsos" del punto de venta ahora muestra
-- también lo que la clienta paga sola (página o app), marcado como "En línea":
--   * paquetes y membresías con link de Clip en línea (external_ref = uuid)
--   * pagos con Stripe (session_ / invoice_), renovaciones automáticas con
--     tarjeta guardada (renewal_) y renovaciones pendientes pagadas en línea (fee_)
--   * multas cobradas a la tarjeta guardada y multas pagadas en recepción
--   * pedidos en línea de Clip que no son paquetes
-- Los cobros del mostrador se muestran igual que antes. Los pagos en línea no
-- se reembolsan desde aquí (se hace en Clip o Stripe).
-- _from/_to filtran por fecha local de Monterrey (inclusive).
DROP FUNCTION IF EXISTS public.pos_recent_sales(integer);
CREATE OR REPLACE FUNCTION public.pos_recent_sales(_limit integer DEFAULT 40, _from date DEFAULT NULL, _to date DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN NOT (public.has_role(auth.uid(), 'admin') OR public.is_staff(auth.uid())) THEN '[]'::jsonb
    ELSE coalesce((
      SELECT jsonb_agg(r ORDER BY r->>'created_at' DESC)
      FROM (
        SELECT r FROM (
          SELECT jsonb_build_object(
            'kind', 'terminal', 'id', tp.id, 'created_at', tp.created_at, 'online', false,
            'method', CASE WHEN coalesce(tp.other_cents, 0) > 0 THEN 'mixto' ELSE 'tarjeta' END,
            'brand', tp.brand, 'amount_cents', tp.amount_cents + coalesce(tp.other_cents, 0),
            'card_cents', tp.amount_cents,
            'other_cents', coalesce(tp.other_cents, 0),
            'other_method', tp.other_method,
            'card_last4', tp.card_last4,
            'refunded', tp.refunded_at IS NOT NULL, 'refund_amount_cents', tp.refund_amount_cents,
            'description', trim(both ', ' FROM
               coalesce((SELECT string_agg((x->>'qty') || ' × ' || (x->>'description'), ', ') FROM jsonb_array_elements(tp.items) x), '')
               || ', ' ||
               coalesce((SELECT string_agg((x->>'qty') || ' × ' || (x->>'name'), ', ') FROM jsonb_array_elements(tp.plans) x), '')),
            'client', (SELECT coalesce(nullif(full_name, ''), email) FROM public.profiles WHERE id = tp.user_id)
          ) r, tp.created_at
          FROM public.pos_terminal_payments tp WHERE tp.status = 'completed'
          UNION ALL
          SELECT jsonb_build_object(
            'kind', 'sale', 'id', s.id, 'created_at', s.created_at, 'online', false,
            'method', s.payment_method, 'brand', coalesce(s.brand, 'laatu'), 'amount_cents', s.total_cents,
            'card_cents', NULL, 'other_cents', NULL, 'other_method', NULL,
            'card_last4', NULL,
            'refunded', s.status = 'reembolsado', 'refund_amount_cents', CASE WHEN s.status = 'reembolsado' THEN s.total_cents END,
            'description', (SELECT string_agg(i.qty || ' × ' || i.description, ', ') FROM public.pos_sale_items i WHERE i.sale_id = s.id),
            'client', (SELECT coalesce(nullif(full_name, ''), email) FROM public.profiles WHERE id = s.user_id)
          ), s.created_at
          FROM public.pos_sales s
          WHERE s.payment_method IN ('efectivo', 'transferencia') AND coalesce(s.external_ref, '') NOT LIKE 'pinpad\_%'
          UNION ALL
          SELECT jsonb_build_object(
            'kind', 'transaction', 'id', t.id, 'created_at', t.created_at, 'online', false,
            'method', t.payment_method, 'brand', 'laatu', 'amount_cents', t.amount_cents,
            'card_cents', NULL, 'other_cents', NULL, 'other_method', NULL,
            'card_last4', NULL,
            'refunded', t.status <> 'completed', 'refund_amount_cents', t.refund_amount_cents,
            'description', '1 × ' || coalesce(p.name, 'Paquete'),
            'client', (SELECT coalesce(nullif(full_name, ''), email) FROM public.profiles WHERE id = t.user_id)
          ), t.created_at
          FROM public.transactions t LEFT JOIN public.token_plans p ON p.id = t.plan_id
          WHERE coalesce(t.external_ref, '') LIKE 'pos\_cash\_%'
          UNION ALL
          -- Compras en línea de paquetes y membresías
          SELECT jsonb_build_object(
            'kind', 'online', 'id', t.id, 'created_at', t.created_at, 'online', true,
            'method', CASE
              WHEN t.external_ref LIKE 'renewal\_%' THEN 'renovacion'
              WHEN t.external_ref LIKE 'session\_%' OR t.external_ref LIKE 'invoice\_%' OR t.external_ref LIKE 'fee\_%' THEN 'stripe'
              ELSE 'clip_online' END,
            'brand', 'laatu', 'amount_cents', t.amount_cents,
            'card_cents', NULL, 'other_cents', NULL, 'other_method', NULL,
            'card_last4', NULL,
            'refunded', t.status <> 'completed', 'refund_amount_cents', t.refund_amount_cents,
            'description', '1 × ' || coalesce(p.name, 'Paquete'),
            'client', (SELECT coalesce(nullif(full_name, ''), email) FROM public.profiles WHERE id = t.user_id)
          ), t.created_at
          FROM public.transactions t LEFT JOIN public.token_plans p ON p.id = t.plan_id
          WHERE t.amount_cents > 0
            AND (t.external_ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-'
                 OR t.external_ref LIKE 'session\_%' OR t.external_ref LIKE 'invoice\_%'
                 OR t.external_ref LIKE 'renewal\_%' OR t.external_ref LIKE 'fee\_%')
          UNION ALL
          -- Pedidos en línea de Clip que no son paquetes (p. ej. merch)
          SELECT jsonb_build_object(
            'kind', 'online', 'id', o.id, 'created_at', o.created_at, 'online', true,
            'method', 'clip_online', 'brand', 'laatu', 'amount_cents', o.amount_cents,
            'card_cents', NULL, 'other_cents', NULL, 'other_method', NULL,
            'card_last4', NULL,
            'refunded', false, 'refund_amount_cents', NULL,
            'description', coalesce(o.description, 'Pedido en línea'),
            'client', (SELECT coalesce(nullif(full_name, ''), email) FROM public.profiles WHERE id = o.user_id)
          ), o.created_at
          FROM public.clip_orders o
          WHERE o.status = 'completed' AND o.kind <> 'plan'
          UNION ALL
          -- Multas cobradas (a la tarjeta guardada o en recepción)
          SELECT jsonb_build_object(
            'kind', 'fee', 'id', f.id, 'created_at', coalesce(f.charged_at, f.created_at),
            'online', coalesce(f.paid_method, 'tarjeta') = 'tarjeta',
            'method', CASE WHEN coalesce(f.paid_method, 'tarjeta') = 'tarjeta' THEN 'tarjeta_guardada' ELSE 'recepcion' END,
            'brand', 'laatu', 'amount_cents', f.amount_cents,
            'card_cents', NULL, 'other_cents', NULL, 'other_method', NULL,
            'card_last4', NULL,
            'refunded', false, 'refund_amount_cents', NULL,
            'description', coalesce(f.reason, 'Multa'),
            'client', (SELECT coalesce(nullif(full_name, ''), email) FROM public.profiles WHERE id = f.user_id)
          ), coalesce(f.charged_at, f.created_at)
          FROM public.membership_fees f
          WHERE f.status = 'charged' AND f.kind = 'multa'
        ) u
        WHERE (_from IS NULL OR (u.created_at AT TIME ZONE 'America/Monterrey')::date >= _from)
          AND (_to IS NULL OR (u.created_at AT TIME ZONE 'America/Monterrey')::date <= _to)
        ORDER BY u.created_at DESC
        LIMIT greatest(least(_limit, 1000), 1)
      ) q(r)
    ), '[]'::jsonb)
  END
$function$;

REVOKE ALL ON FUNCTION public.pos_recent_sales(integer, date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.pos_recent_sales(integer, date, date) TO authenticated;
