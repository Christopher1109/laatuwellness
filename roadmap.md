# Roadmap — Política de cancelación/faltas + renovación con tarjeta

- [ ] Migración: cancellation_policy, no_shows, saved_cards, renewal_opt_outs, token_plans.no_show_penalty, register_falta, miss_status, waive_*, reescritura de cancel_booking/mark_no_show/clear_check_in, trigger PENDING_FINE, renewal_status, due_renewals, continuidad de renovación en trg_set_membership_access
- [ ] Server fns Stripe: createCardSetupSession (modo setup), payMyMembershipFee, processMyRenewal; webhook card_setup; ruta /api/public/renewals/run
- [ ] Cliente: confirmación de cancelación con aviso según plan (cuenta + app), banner de faltas/multa pendiente, sección Método de pago con consentimiento, modal de renovación (≤7 días)
- [ ] Admin: panel Políticas (config + checklist de planes + reporte + vencimientos sin tarjeta), sección de faltas/multas/tarjeta en ficha de cliente, anular falta / condonar multa
- [ ] Tests de reglas (12h, 3ª falta, reinicio de contador) + build + verificación
