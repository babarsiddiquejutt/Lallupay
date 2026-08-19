-- RLS answers which rows a user may access; column privileges also protect server-owned fields.
revoke update (kyc_status, kyc_tier, transaction_pin_hash, created_at, updated_at) on public.profiles from authenticated;
revoke update (user_id, title, body, created_at) on public.notifications from authenticated;
revoke insert, update, delete on public.wallets from authenticated;
revoke insert, update, delete on public.ledger_accounts from authenticated;
revoke insert, update, delete on public.ledger_entries from authenticated;
revoke insert, update, delete on public.transactions from authenticated;
revoke insert, update, delete on public.idempotency_keys from authenticated;
revoke insert, update, delete on public.conversions from authenticated;
revoke insert, update, delete on public.withdrawals from authenticated;
revoke insert, update, delete on public.rates from authenticated;
revoke insert, update, delete on public.admin_roles from authenticated;
revoke insert, update, delete on public.aml_risk_flags from authenticated;
revoke insert, update, delete on public.reconciliation_reports from authenticated;
