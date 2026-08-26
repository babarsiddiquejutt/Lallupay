-- Server-authoritative internal (user-to-user) transfer execution.
-- Forward-only. Safe to review before `supabase db push`.
--
-- This migration:
--   1. Adds a service-role-only recipient lookup that safely resolves an exact
--      identifier (username / email / mobile) to a user id without exposing
--      other users' profiles to the browser (profiles RLS stays owner-only).
--   2. Rewrites execute_internal_transfer to ALSO record the dedicated
--      public.transfers row and to validate idempotency-key reuse against the
--      material transfer details (recipient, asset, amount), mirroring the
--      security-reviewed conversion pattern. All existing safety (advisory lock,
--      sandbox gate, balanced double-entry ledger, audit log) is preserved.
--   3. Hardens EXECUTE privileges so only the service role (i.e. the reviewed
--      Edge Function) can call these functions — never an authenticated browser
--      client with a forged sender/recipient.

-- Recipient resolution runs only inside the authenticated transfer Edge Function.
create or replace function public.lookup_transfer_recipient(p_method text, p_value text)
returns table(id uuid, username text, full_name text)
language plpgsql stable security definer set search_path = public as $$
declare v_value text := btrim(coalesce(p_value, ''));
begin
  if length(v_value) = 0 then return; end if;
  if p_method = 'username' then
    return query select p.id, p.username, p.full_name from public.profiles p where p.username = lower(v_value) limit 1;
  elsif p_method = 'mobile' then
    return query select p.id, p.username, p.full_name from public.profiles p where p.mobile = v_value limit 1;
  elsif p_method = 'email' then
    return query select p.id, p.username, p.full_name from public.profiles p join auth.users u on u.id = p.id where lower(u.email) = lower(v_value) limit 1;
  end if;
  return;
end; $$;
revoke all on function public.lookup_transfer_recipient(text, text) from public, authenticated, anon;
grant execute on function public.lookup_transfer_recipient(text, text) to service_role;

-- Replace the 5-argument transfer executor with a 6-argument version that records
-- the lookup method used to reach the recipient. No DB object depends on it.
drop function if exists public.execute_internal_transfer(uuid, uuid, public.asset_code, numeric, text);

create or replace function public.execute_internal_transfer(
  p_sender uuid, p_recipient uuid, p_asset public.asset_code, p_amount numeric, p_key text, p_lookup_method text default 'username'
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_group uuid := gen_random_uuid();
  v_tx uuid := gen_random_uuid();
  v_existing public.transfers%rowtype;
  v_balance numeric;
  v_sandbox boolean;
  v_licensed boolean;
begin
  if p_key is null or length(p_key) < 16 then raise exception 'A valid idempotency key is required'; end if;
  if p_amount <= 0 or scale(p_amount) > 8 then raise exception 'Invalid transfer amount'; end if;
  if p_sender = p_recipient then raise exception 'You cannot transfer to yourself'; end if;
  if p_lookup_method not in ('email', 'username', 'mobile', 'qr') then raise exception 'Invalid recipient lookup method'; end if;

  -- Serialise concurrent debits of the same sender balance to prevent overdraft races.
  perform pg_advisory_xact_lock(hashtext(p_sender::text || ':' || p_asset::text));

  select sandbox_mode, licensing_obtained into v_sandbox, v_licensed from system_config where id = true;
  if not v_sandbox and not v_licensed then raise exception 'Live financial operations are blocked until licensing is recorded'; end if;

  -- Idempotent replay: the same key must describe the same transfer, otherwise reject.
  select * into v_existing from transfers where sender_id = p_sender and idempotency_key = p_key;
  if found then
    if v_existing.recipient_id <> p_recipient or v_existing.asset_code <> p_asset or v_existing.amount <> p_amount then
      raise exception 'Idempotency key was already used for a different transfer';
    end if;
    return v_existing.transaction_id;
  end if;

  if not exists(select 1 from profiles where id = p_recipient) then raise exception 'Recipient not found'; end if;

  select coalesce(sum(le.amount), 0) into v_balance from ledger_entries le join ledger_accounts la on la.id = le.ledger_account_id where la.owner_id = p_sender and la.asset_code = p_asset;
  if v_balance < p_amount then raise exception 'Insufficient funds'; end if;

  insert into ledger_entries(transaction_group_id, ledger_account_id, asset_code, amount) select v_group, id, p_asset, -p_amount from ledger_accounts where owner_id = p_sender and asset_code = p_asset;
  insert into ledger_entries(transaction_group_id, ledger_account_id, asset_code, amount) select v_group, id, p_asset, p_amount from ledger_accounts where owner_id = p_recipient and asset_code = p_asset;
  if (select coalesce(sum(amount), 0) from ledger_entries where transaction_group_id = v_group) <> 0 then raise exception 'Ledger transaction is unbalanced'; end if;

  insert into transactions(id, user_id, asset_code, amount, net_amount, type, status, reference)
  values (v_tx, p_sender, p_asset, p_amount, -p_amount, 'transfer_out', 'completed', 'TRF-' || v_tx),
         (gen_random_uuid(), p_recipient, p_asset, p_amount, p_amount, 'transfer_in', 'completed', 'TRF-' || v_tx || '-IN');

  insert into transfers(transaction_id, sender_id, recipient_id, asset_code, amount, lookup_method, idempotency_key)
  values (v_tx, p_sender, p_recipient, p_asset, p_amount, p_lookup_method, p_key);

  insert into audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (p_sender, 'transfer.executed', 'transaction', v_tx::text, jsonb_build_object('recipient_id', p_recipient, 'asset', p_asset, 'amount', p_amount, 'lookup_method', p_lookup_method));

  return v_tx;
end; $$;
revoke all on function public.execute_internal_transfer(uuid, uuid, public.asset_code, numeric, text, text) from public, authenticated, anon;
grant execute on function public.execute_internal_transfer(uuid, uuid, public.asset_code, numeric, text, text) to service_role;
