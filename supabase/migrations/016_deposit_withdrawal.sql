-- Migration 016: Deposit and withdrawal flows.
-- Forward-only. Safe to review before `supabase db push`.

-- 1. User submits a deposit record (USDT TRC20).
--    The deposit starts as 'pending'. Admin reviews and confirms.
create or replace function public.submit_deposit(
  p_user uuid,
  p_txid text,
  p_amount numeric,
  p_address text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_deposit uuid := gen_random_uuid();
  v_network uuid;
begin
  if p_amount <= 0 or scale(p_amount) > 8 then raise exception 'Invalid deposit amount'; end if;
  if p_txid is null or length(trim(p_txid)) < 10 then raise exception 'A valid transaction hash is required'; end if;
  if not exists(select 1 from profiles where id = p_user) then raise exception 'User not found'; end if;

  -- Duplicate TXID check.
  if exists(select 1 from deposits where txid = trim(p_txid)) then
    raise exception 'This transaction hash has already been submitted';
  end if;

  -- Get the TRC20 network ID.
  select id into v_network from networks where network_code = 'TRC20' and asset_code = 'USDT' limit 1;
  if not found then
    -- Fallback: create the network if it doesn't exist.
    insert into networks(asset_code, name, network_code, confirmations_required, enabled)
    values ('USDT', 'TRON (TRC20)', 'TRC20', 1, true)
    on conflict (network_code) do nothing
    returning id into v_network;
    if v_network is null then
      select id into v_network from networks where network_code = 'TRC20' limit 1;
    end if;
  end if;

  insert into deposits(id, user_id, asset_code, amount, txid, network_id, status)
  values (v_deposit, p_user, 'USDT', p_amount, trim(p_txid), v_network, 'pending');

  insert into audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (p_user, 'deposit.submitted', 'deposit', v_deposit::text,
          jsonb_build_object('txid', trim(p_txid), 'amount', p_amount, 'address', p_address));

  return v_deposit;
end; $$;

revoke all on function public.submit_deposit(uuid, text, numeric, text) from public, authenticated, anon;
grant execute on function public.submit_deposit(uuid, text, numeric, text) to service_role;
grant execute on function public.submit_deposit(uuid, text, numeric, text) to authenticated;

-- 2. User requests a withdrawal (USDT TRC20).
--    Requires approved KYC. Deducts from ledger atomically (pending state).
create or replace function public.request_withdrawal(
  p_user uuid,
  p_amount numeric,
  p_address text,
  p_idempotency_key text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_withdrawal uuid := gen_random_uuid();
  v_balance numeric;
  v_sandbox boolean;
  v_licensed boolean;
  v_group uuid := gen_random_uuid();
  v_network uuid;
  v_kyc text;
begin
  if p_amount <= 0 or scale(p_amount) > 8 then raise exception 'Invalid withdrawal amount'; end if;
  if p_address is null or length(trim(p_address)) < 10 then raise exception 'A valid TRC20 address is required'; end if;
  if p_idempotency_key is not null and length(p_idempotency_key) < 16 then raise exception 'Invalid idempotency key'; end if;

  -- KYC check.
  select kyc_status into v_kyc from profiles where id = p_user;
  if v_kyc <> 'approved' then raise exception 'KYC verification is required for withdrawals'; end if;

  -- Check sandbox/licensing.
  select sandbox_mode, licensing_obtained into v_sandbox, v_licensed from system_config where id = true;
  if not v_sandbox and not v_licensed then raise exception 'Live financial operations are blocked until licensing is recorded'; end if;

  -- Idempotency check.
  if p_idempotency_key is not null then
    if exists(select 1 from withdrawals where user_id = p_user and idempotency_key = p_idempotency_key) then
      select id into v_withdrawal from withdrawals where user_id = p_user and idempotency_key = p_idempotency_key;
      return v_withdrawal;
    end if;
  end if;

  -- Balance check.
  select coalesce(sum(le.amount), 0) into v_balance
  from ledger_entries le join ledger_accounts la on la.id = le.ledger_account_id
  where la.owner_id = p_user and la.asset_code = 'USDT';
  if v_balance < p_amount then raise exception 'Insufficient USDT balance'; end if;

  -- Get the TRC20 network.
  select id into v_network from networks where network_code = 'TRC20' and asset_code = 'USDT' limit 1;

  -- Create the withdrawal record.
  insert into withdrawals(id, user_id, asset_code, amount, address, network_id, status, idempotency_key)
  values (v_withdrawal, p_user, 'USDT', p_amount, trim(p_address), v_network, 'pending', p_idempotency_key);

  -- Reserve the balance: debit the user's ledger (pending state).
  insert into ledger_entries(transaction_group_id, ledger_account_id, asset_code, amount)
    select v_group, id, 'USDT', -p_amount from ledger_accounts where owner_id = p_user and asset_code = 'USDT';

  insert into transactions(user_id, asset_code, amount, fee, net_amount, type, status, reference, metadata)
  values (p_user, 'USDT', p_amount, 0, -p_amount, 'withdrawal', 'pending', 'WD-' || v_withdrawal,
          jsonb_build_object('withdrawal_id', v_withdrawal, 'address', trim(p_address)));

  insert into audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (p_user, 'withdrawal.requested', 'withdrawal', v_withdrawal::text,
          jsonb_build_object('amount', p_amount, 'address', trim(p_address)));

  return v_withdrawal;
end; $$;

revoke all on function public.request_withdrawal(uuid, numeric, text, text) from public, authenticated, anon;
grant execute on function public.request_withdrawal(uuid, numeric, text, text) to service_role;
grant execute on function public.request_withdrawal(uuid, numeric, text, text) to authenticated;

-- 3. Admin: confirm a deposit (credits the user's wallet).
create or replace function public.admin_confirm_deposit(
  p_deposit uuid,
  p_admin uuid,
  p_txid text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_deposit deposits%rowtype;
  v_group uuid := gen_random_uuid();
begin
  -- Admin auth check.
  if not exists(
    select 1 from admin_roles ar
    left join role_permissions rp on rp.role = ar.role
    where ar.user_id = p_admin and (ar.role = 'SUPER' or rp.permission_code = 'finance.approve')
  ) then raise exception 'Not authorised to approve deposits'; end if;

  select * into v_deposit from deposits where id = p_deposit;
  if not found then raise exception 'Deposit not found'; end if;
  if v_deposit.status <> 'pending' then raise exception 'Deposit is not pending'; end if;

  -- Update status.
  update deposits set status = 'confirmed', reviewed_by = p_admin, reviewed_at = now(),
    transaction_id = (select id from transactions where reference = 'DEP-' || p_deposit::text limit 1)
  where id = p_deposit;

  -- Credit the user's USDT ledger.
  insert into ledger_entries(transaction_group_id, ledger_account_id, asset_code, amount)
    select v_group, id, 'USDT', v_deposit.amount from ledger_accounts where owner_id = v_deposit.user_id and asset_code = 'USDT';

  -- Record the user-facing transaction.
  insert into transactions(user_id, asset_code, amount, fee, net_amount, type, status, reference, metadata)
  values (v_deposit.user_id, 'USDT', v_deposit.amount, 0, v_deposit.amount, 'deposit', 'completed',
          'DEP-' || p_deposit::text, jsonb_build_object('deposit_id', p_deposit, 'txid', coalesce(p_txid, v_deposit.txid)));

  -- Update wallet balance snapshot.
  update wallets set balance_snapshot = (
    select coalesce(sum(le.amount), 0) from ledger_entries le
    join ledger_accounts la on la.id = le.ledger_account_id
    where la.owner_id = v_deposit.user_id and la.asset_code = 'USDT'
  ), updated_at = now()
  where user_id = v_deposit.user_id and asset_code = 'USDT';

  -- Notify the user.
  insert into notifications(user_id, title, body)
  values (v_deposit.user_id, 'Deposit confirmed', 'Your USDT deposit has been confirmed and credited to your wallet.');

  insert into audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (p_admin, 'deposit.confirmed', 'deposit', p_deposit::text,
          jsonb_build_object('user_id', v_deposit.user_id, 'amount', v_deposit.amount));

  return p_deposit;
end; $$;

revoke all on function public.admin_confirm_deposit(uuid, uuid, text) from public, authenticated, anon;
grant execute on function public.admin_confirm_deposit(uuid, uuid, text) to service_role;

-- 4. Admin: reject a deposit.
create or replace function public.admin_reject_deposit(
  p_deposit uuid,
  p_admin uuid,
  p_reason text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_deposit deposits%rowtype;
begin
  if not exists(
    select 1 from admin_roles ar
    left join role_permissions rp on rp.role = ar.role
    where ar.user_id = p_admin and (ar.role = 'SUPER' or rp.permission_code = 'finance.approve')
  ) then raise exception 'Not authorised to reject deposits'; end if;

  select * into v_deposit from deposits where id = p_deposit;
  if not found then raise exception 'Deposit not found'; end if;
  if v_deposit.status <> 'pending' then raise exception 'Deposit is not pending'; end if;

  update deposits set status = 'rejected', reviewed_by = p_admin, reviewed_at = now()
  where id = p_deposit;

  insert into notifications(user_id, title, body)
  values (v_deposit.user_id, 'Deposit rejected', 'Your deposit was not confirmed. ' || coalesce(p_reason, ''));

  insert into audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (p_admin, 'deposit.rejected', 'deposit', p_deposit::text,
          jsonb_build_object('reason', p_reason));

  return p_deposit;
end; $$;

revoke all on function public.admin_reject_deposit(uuid, uuid, text) from public, authenticated, anon;
grant execute on function public.admin_reject_deposit(uuid, uuid, text) to service_role;

-- 5. Admin: approve a withdrawal (marks as processing).
create or replace function public.admin_approve_withdrawal(
  p_withdrawal uuid,
  p_admin uuid
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_withdrawal withdrawals%rowtype;
begin
  if not exists(
    select 1 from admin_roles ar
    left join role_permissions rp on rp.role = ar.role
    where ar.user_id = p_admin and (ar.role = 'SUPER' or rp.permission_code = 'finance.approve')
  ) then raise exception 'Not authorised to approve withdrawals'; end if;

  select * into v_withdrawal from withdrawals where id = p_withdrawal;
  if not found then raise exception 'Withdrawal not found'; end if;
  if v_withdrawal.status <> 'pending' then raise exception 'Withdrawal is not pending'; end if;

  update withdrawals set status = 'processing', reviewed_by = p_admin, reviewed_at = now() where id = p_withdrawal;

  insert into notifications(user_id, title, body)
  values (v_withdrawal.user_id, 'Withdrawal approved', 'Your withdrawal request has been approved and is being processed.');

  insert into audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (p_admin, 'withdrawal.approved', 'withdrawal', p_withdrawal::text,
          jsonb_build_object('amount', v_withdrawal.amount));

  return p_withdrawal;
end; $$;

revoke all on function public.admin_approve_withdrawal(uuid, uuid) from public, authenticated, anon;
grant execute on function public.admin_approve_withdrawal(uuid, uuid) to service_role;

-- 6. Admin: complete a withdrawal (after blockchain TX confirmed).
create or replace function public.admin_complete_withdrawal(
  p_withdrawal uuid,
  p_admin uuid,
  p_txid text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_withdrawal withdrawals%rowtype;
  v_group uuid;
begin
  if not exists(
    select 1 from admin_roles ar
    left join role_permissions rp on rp.role = ar.role
    where ar.user_id = p_admin and (ar.role = 'SUPER' or rp.permission_code = 'finance.approve')
  ) then raise exception 'Not authorised to complete withdrawals'; end if;

  select * into v_withdrawal from withdrawals where id = p_withdrawal;
  if not found then raise exception 'Withdrawal not found'; end if;
  if v_withdrawal.status <> 'processing' then raise exception 'Withdrawal is not in processing state'; end if;

  update withdrawals set status = 'completed', reviewed_by = p_admin, reviewed_at = now(), txid = p_txid where id = p_withdrawal;

  -- Find the transaction group for this withdrawal's ledger entry.
  select le.transaction_group_id into v_group from transactions t
  join ledger_entries le on le.asset_code = t.asset_code
  where t.reference = 'WD-' || p_withdrawal::text limit 1;

  -- Update the transaction.
  update transactions set status = 'completed', metadata = metadata || jsonb_build_object('txid', p_txid)
  where reference = 'WD-' || p_withdrawal::text;

  -- Update wallet balance snapshot.
  update wallets set balance_snapshot = (
    select coalesce(sum(le.amount), 0) from ledger_entries le
    join ledger_accounts la on la.id = le.ledger_account_id
    where la.owner_id = v_withdrawal.user_id and la.asset_code = 'USDT'
  ), updated_at = now()
  where user_id = v_withdrawal.user_id and asset_code = 'USDT';

  insert into notifications(user_id, title, body)
  values (v_withdrawal.user_id, 'Withdrawal completed', 'Your withdrawal has been sent to your TRC20 address.');

  insert into audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (p_admin, 'withdrawal.completed', 'withdrawal', p_withdrawal::text,
          jsonb_build_object('txid', p_txid));

  return p_withdrawal;
end; $$;

revoke all on function public.admin_complete_withdrawal(uuid, uuid, text) from public, authenticated, anon;
grant execute on function public.admin_complete_withdrawal(uuid, uuid, text) to service_role;

-- 7. Admin: reject a withdrawal (returns funds to user's ledger).
create or replace function public.admin_reject_withdrawal(
  p_withdrawal uuid,
  p_admin uuid,
  p_reason text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_withdrawal withdrawals%rowtype;
  v_group uuid := gen_random_uuid();
begin
  if not exists(
    select 1 from admin_roles ar
    left join role_permissions rp on rp.role = ar.role
    where ar.user_id = p_admin and (ar.role = 'SUPER' or rp.permission_code = 'finance.approve')
  ) then raise exception 'Not authorised to reject withdrawals'; end if;

  select * into v_withdrawal from withdrawals where id = p_withdrawal;
  if not found then raise exception 'Withdrawal not found'; end if;
  if v_withdrawal.status not in ('pending', 'processing') then raise exception 'Withdrawal cannot be rejected in current state'; end if;

  -- Refund the reserved ledger entry.
  insert into ledger_entries(transaction_group_id, ledger_account_id, asset_code, amount)
    select v_group, id, 'USDT', v_withdrawal.amount from ledger_accounts where owner_id = v_withdrawal.user_id and asset_code = 'USDT';

  update withdrawals set status = 'failed', reviewed_by = p_admin, reviewed_at = now() where id = p_withdrawal;

  -- Update wallet snapshot.
  update wallets set balance_snapshot = (
    select coalesce(sum(le.amount), 0) from ledger_entries le
    join ledger_accounts la on la.id = le.ledger_account_id
    where la.owner_id = v_withdrawal.user_id and la.asset_code = 'USDT'
  ), updated_at = now()
  where user_id = v_withdrawal.user_id and asset_code = 'USDT';

  -- Update the pending transaction.
  update transactions set status = 'failed', metadata = metadata || jsonb_build_object('rejection_reason', p_reason)
  where reference = 'WD-' || p_withdrawal::text;

  insert into notifications(user_id, title, body)
  values (v_withdrawal.user_id, 'Withdrawal rejected', 'Your withdrawal was not processed. ' || coalesce(p_reason, ''));

  insert into audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (p_admin, 'withdrawal.rejected', 'withdrawal', p_withdrawal::text,
          jsonb_build_object('reason', p_reason));

  return p_withdrawal;
end; $$;

revoke all on function public.admin_reject_withdrawal(uuid, uuid, text) from public, authenticated, anon;
grant execute on function public.admin_reject_withdrawal(uuid, uuid, text) to service_role;
