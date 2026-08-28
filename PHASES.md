# LaluPay delivery progress

- [x] **Phase 1 — Foundation:** Vite React TypeScript app, Supabase client guard, email/password + Google authentication UI, typed data layer, RLS migration foundation, realtime helper, responsive shell, CI.
- [x] **Phase 2 — Wallets & conversion:** Ledger-backed wallets, wallet realtime updates, server-side PKR ↔ USDT conversion quotes, atomic conversion execution with idempotency, rate and fee administration, production licensing guard.
- [x] **Phase 3 — Transfers:** Recipient lookup (username/email/mobile), server-authoritative internal transfer with advisory locking, idempotency, double-entry ledger, transfer ledger row, audit logging.
- [x] **Phase 4 — P2P marketplace (SELL only):** Advertisements, USDT escrow order state machine, buyer→seller PKR settlement off-platform, payment proof upload, dispute opening/resolution, realtime order status and chat, payment method management, order expiry via scheduled maintenance.
- [x] **Profile & notifications:** Profile display/edit, KYC submission page, notification surface on Dashboard, realtime notification subscription.
- [x] **Phase 5 — Admin & compliance:** Admin dashboard, user management, KYC review, transaction monitoring, P2P monitoring, dispute management, audit logs.
- [ ] **Phase 6 — Partner API & webhooks.**
- [ ] **Phase 7 — Expo mobile applications.**

## Deployment

- **GitHub Actions CI:** lint → typecheck → build on every push/PR.
- **InfinityFree deployment:** production build uploaded via FTP on push to `main`.
- **Scheduled maintenance:** GitHub Actions cron invokes the `scheduled-maintenance` Edge Function every 5 minutes to expire overdue P2P orders.

## Architecture notes

- All money mutations run inside service-role RPCs called by Deno Edge Functions; the browser never calls ledger RPCs directly.
- RLS is enforced on every application table; column-level privileges prevent browser clients from writing server-owned fields.
- Advisory locks serialise concurrent debits to prevent overdraft races.
- Idempotency keys prevent duplicate transfers, conversions, and P2P orders.
- Double-entry ledger is the single source of truth; wallet `balance_snapshot` is ledger-derived via trigger.
