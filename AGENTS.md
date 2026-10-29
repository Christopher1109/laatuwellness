<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Public program content uses route loaders backed by public-catalog server functions and a fresh anonymous publishable client with explicit public-column projections, so SSR includes catalog content without inheriting sessions or privileged access; live schedules remain client-side.
- Self-referencing canonical links belong on public leaf routes, never the root layout, to avoid duplicate canonical tags.
- Package lots and membership transactions calculate validity through the shared database purchase_validity_start function; this keeps every payment channel consistent and records package start dates for client display.
- Client-profile checkout reuses POS cash fulfillment and Clip terminal server functions; cash amounts are validated server-side, and card purchases are credited only after terminal approval so profile purchases follow the same fulfillment rules as the counter.
- Client purchase labels and package filters derive from completed transactions, not credit balances; this preserves purchased-package history independently of remaining credits and excludes unpaid/refunded sales.
- Staff navigation is constrained by the shared admin-navigation access rule, with database roles enforcing data access independently of menu visibility.
- The staff tablet Check-in shortcut opens the existing CheckInPanel through the team-only shortcut guard; it need not appear in the sidebar menu.
- Shared admin tablet styling is scoped to admin-panel and admin-detail, with touch-sized controls and an overlay sidebar below xl to preserve workspace width without affecting public pages.
- The app sends team accounts to the existing protected admin route after role resolution; sharing the web panel preserves role permissions and avoids a separate app permission model.
- Schedule hour entry uses a dedicated quick-entry control and the existing pending-template mutation, preserving month scope and explicit class publishing.
- Direct password resets use one authenticated server function that verifies the caller through user_roles before resolving targets and invoking privileged Auth updates; reusable controls cover staff, coaches and clients without exposing or storing passwords.
- Schedule templates carry coach and class type separately, plus is_tbd ("Por definir": published with "Coach por anunciar") and an optional actual_start for blocks that begin off the row time; publish_schedule_range works in America/Monterrey local time and never overwrites classes marked manual_override (single-class substitutions made from the class drawer).
- Clients see and book classes only inside booking_window_end() (today plus seven full days); the classes read policy and book_class/join_waitlist enforce it, and the web/app ranges mirror it through src/lib/booking-window.ts.
- Staff and coach accounts are created and edited from the team panels through saveTeamMember, which sets email and password directly on the auth user (email_confirm, no emails sent) and keeps user_roles in sync with the staff_profiles role.
- Credits carry a credit_kind (general, doris_ul, doris_fb) on token_plans, token_ledger, credit_lots and bookings; class_credit_kind() decides what a class needs (class_types.credit_kind, else rehabilitacion = any DorisFisio credit), and booking, cancellations and refunds only move lots of the matching kind, so studio credits never pay for DorisFisio and Upper/Lower never pays for Full Body.
- DorisFisio uses the team role "recovery" (not coach): is_staff includes it, is_recovery() scopes her writes to the rehabilitacion module and her own plans, and the admin route shows her only her consultorio, clients, packages and "Mis consultas" (recovery_sessions).
