-- Wallet snapshots are ledger-derived but must be delivered live to their owners.
alter publication supabase_realtime add table public.wallets;
