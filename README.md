# LaluPay

LaluPay is a sandbox-first digital-wallet platform foundation built with React, TypeScript, Supabase, and GitHub Actions. It is **not licensed or configured to custody real funds**. `system_config.sandbox_mode` starts enabled and live activity must remain blocked until legal, security, and operational reviews are complete.

## Included

- Vite/React strict-TypeScript web foundation with responsive shell and friendly missing-Supabase screen.
- Centralized typed Supabase client, domain data modules, Supabase Auth (email/password and Google), and cleanup-safe Postgres Changes subscriptions.
- Forward-only Supabase migrations for profiles, wallets, a double-entry ledger, transactions, idempotency, notifications, P2P core, audit logs, RLS, and realtime publication.
- A server-side, idempotent internal-transfer Edge Function backed by an atomic Postgres RPC. The browser cannot write ledger entries or balances.
- CI, an opt-in GitHub Actions InfinityFree static deployment workflow, and a protected scheduler workflow template.

## Local setup

1. Install Node.js 22+ and the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started).
2. Copy `.env.example` to `.env.local` and add only the project URL and **anon public** key.
3. Run `corepack enable`, `pnpm install`, then `pnpm run dev`.
4. Create a Supabase project; update `supabase/config.toml` only with the public project reference, enable Email and Google authentication, and configure its production redirect URLs.
5. Review the forward-only files in `supabase/migrations/`, then link and apply them with `supabase link --project-ref YOUR_PROJECT_REF` and `supabase db push`. Private `kyc-documents` and `app-releases` buckets plus their storage policies are created by migration `004`.
6. Copy `supabase/.env.example` locally if needed, but set backend-only values with `supabase secrets set SUPABASE_SERVICE_ROLE_KEY=... SCHEDULER_TOKEN=...`. Deploy reviewed functions with `supabase functions deploy transfer` and `supabase functions deploy scheduled-maintenance`.
7. Validate before publishing: `pnpm run lint`, `pnpm run typecheck`, and `pnpm run build`.

## GitHub and InfinityFree

Push to a GitHub repository, then configure these repository/environment secrets: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `INFINITYFREE_FTP_SERVER`, `INFINITYFREE_FTP_USERNAME`, `INFINITYFREE_FTP_PASSWORD`, `INFINITYFREE_FTP_PATH`, `SUPABASE_URL`, and `SCHEDULER_TOKEN`.

The deploy workflow only uploads `dist/` and never handles a service-role key. Add the final InfinityFree domain to Supabase Auth Site URL and Redirect URLs before enabling automatic deployment.

## Supabase security model

The frontend client is created exclusively from `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. No browser module references a service-role key. RLS permits users to read only their own financial records; balance, ledger, conversion, withdrawal, and transfer mutations have no client policy. The browser calls the `transfer` Edge Function, which validates the caller’s JWT before using the service-role key held exclusively in Supabase Edge Function secrets. Ledger and audit rows are immutable at the database layer.

## Security boundary

Do not expose database passwords, service-role keys, scheduler tokens, FTP credentials, or provider API keys in the repository, frontend bundle, or mobile app. Financial mutations belong in reviewed Edge Functions and atomic SQL/RPC transactions, with RLS enabled for every table.
