# SEO public content

# App team panel

- [x] Open the shared web panel for admin, staff and coaches from the app, preserving existing role access.
- [x] Pass 7 navigation/access tests; verify installed-app entry with real admin, staff5 and coach sessions, mobile menu navigation and reload. Client session remains in the customer app; no purchases or bookings changed.

# Administrator password reset

- [x] Add admin-only direct password changes for users without recovery emails.
- [x] Test authorization (6 regression tests) and verify staff, coach and client dialogs with the real admin account; confirmation mismatch is blocked. No existing password was changed, so reset followed by sign-in remains unverified live.

# Faster schedule entry and staff access

- [x] Simplify adding schedule hours without changing schedule publishing rules; verified save and reload with staff5.
- [x] Apply and test the requested staff navigation and verify real client reads with staff5.
- [x] Replace email-based staff5 recovery with administrator-set passwords, as requested; the administrator can now choose a new password from Staff.

# Client purchase labels

- [x] Remove only Monica Alanis's fictitious 5 Classes purchase and its related credits/history.
- [x] Add purchased-package labels and package filtering to client cards.
- [x] Test filtering and verify Monica's cleaned history and client labels in the panel.

# Client profile checkout

- [x] Replace profile payment labels with cash checkout and Clip terminal collection.
- [x] Verify cash/change tests, existing purchase history, and authenticated rejection of an ineligible purchase; no real cash sale or terminal charge was generated, so approval and post-payment refresh remain unverified live.

# Opening validity

- [x] Apply October 26 opening floor to package and membership validity, including prior purchases.
- [x] Verify opening dates and post-opening purchases with regression tests, stored data, and authenticated account display.

- [x] Render program details, program list, and homepage programs in initial server HTML using anonymous public reads.
- [x] Add program-specific descriptions and self-referencing canonicals for sitemap pages.
- [x] Add only the requested discreet location section before the homepage closing section.
- [x] Verify initial HTML, not-found behavior, client navigation, and desktop/mobile layout without payment or booking writes.