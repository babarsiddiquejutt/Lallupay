-- Server-authoritative P2P (USDT sell) escrow execution.
-- Forward-only. Safe to review before `supabase db push`. Nothing here is applied automatically.
--
-- Settlement model (product-confirmed):
--   * Only USDT is escrowed by the platform. PKR is NEVER escrowed.
--   * A USDT seller offers a sell advertisement; a buyer opens an order; the
--     seller's USDT is locked in a platform escrow ledger account; the buyer
--     pays PKR DIRECTLY to the seller off-platform (Easypaisa/JazzCash/bank),
--     optionally uploads proof; the seller confirms PKR receipt; escrowed USDT
--     is released to the buyer.
--   * Disputes cover contested PKR payment/receipt and are resolved by staff.
--
-- This migration is additive only. It does not create any PKR escrow balance and
-- does not alter the existing transfer/convert logic. All money movement stays in
-- the existing double-entry ledger and every executor is service-role-only.

-- 1. Escrow ledger account (USDT only; owner_id null, like the existing SYSTEM pools).
insert into public.ledger_accounts(owner_id, asset_code, account_code) values
  (null, 'USDT', 'SYSTEM_P2P_ESCROW_USDT')
on conflict (account_code) do nothing;

-- 2. Advertisement gains the maker's receiving account (where the buyer sends PKR).
alter table public.p2p_advertisements add column if not exists payment_method_id uuid references public.payment_methods on delete restrict;

-- 3. Orders gain server-owned snapshots so an ad edit can never change an in-flight order.
alter table public.p2p_orders add column if not exists price numeric(18,6);            -- PKR per USDT, snapshot at creation
alter table public.p2p_orders add column if not exists crypto_amount numeric(24,8);    -- USDT escrowed = trunc(amount / price, 8)
alter table public.p2p_orders add column if not exists payment_method_id uuid references public.payment_methods on delete restrict;
alter table public.p2p_orders add column if not exists initiated_by uuid references public.profiles on delete restrict;
alter table public.p2p_orders add column if not exists idempotency_key text;
alter table public.p2p_orders add column if not exists payment_sent_at timestamptz;
alter table public.p2p_orders add column if not exists completed_at timestamptz;
alter table public.p2p_orders add column if not exists cancelled_at timestamptz;

-- Idempotent order creation: the same initiator + key must resolve to the same order.
create unique index if not exists p2p_orders_initiator_idempotency_idx on public.p2p_orders(initiated_by, idempotency_key) where idempotency_key is not null;

-- Defence in depth: orders are written only by the service role (RLS already grants no client write policy).
revoke insert, update, delete on public.p2p_orders from authenticated;

-- 4. Masked payment details are disclosed only to the two order participants, never third parties.
--    Returns the payable account identifier to the counterparty (the buyer needs it to pay).
--    SANDBOX NOTE: payment_methods.encrypted_details is stored as-provided in sandbox; production
--    must encrypt it at rest (KMS/Edge) — this function is the only sanctioned disclosure path.
create or replace function public.get_p2p_order_payment_details(p_order uuid, p_actor uuid)
returns table(method_type text, account_name text, account_reference_masked text, payable_detail text)
language plpgsql stable security definer set search_path = public as $$
begin
  return query
  select pm.method_type, pm.account_name, pm.account_reference_masked, pm.encrypted_details
  from public.p2p_orders o
  join public.payment_methods pm on pm.id = o.payment_method_id
  where o.id = p_order and p_actor in (o.buyer_id, o.seller_id);
end; $$;
revoke all on function public.get_p2p_order_payment_details(uuid, uuid) from public, authenticated, anon;
grant execute on function public.get_p2p_order_payment_details(uuid, uuid) to service_role;

-- 5. Create a USDT sell order and atomically lock the seller's USDT into escrow.
create or replace function public.create_p2p_sell_order(p_ad uuid, p_buyer uuid, p_amount numeric, p_key text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_ad public.p2p_advertisements%rowtype;
  v_existing public.p2p_orders%rowtype;
  v_order uuid := gen_random_uuid();
  v_group uuid := gen_random_uuid();
  v_seller uuid;
  v_price numeric(18,6);
  v_crypto numeric(24,8);
  v_balance numeric;
  v_sandbox boolean;
  v_licensed boolean;
begin
  if p_key is null or length(p_key) < 16 then raise exception 'A valid idempotency key is required'; end if;
  if p_amount is null or p_amount <= 0 or scale(p_amount) > 2 then raise exception 'Invalid PKR amount'; end if;

  select * into v_ad from p2p_advertisements where id = p_ad;
  if not found then raise exception 'Advertisement not found'; end if;
  if v_ad.side <> 'sell' then raise exception 'Only sell advertisements can be taken in this release'; end if;
  if v_ad.status <> 'active' then raise exception 'Advertisement is not active'; end if;

  v_seller := v_ad.owner_id;
  if v_seller = p_buyer then raise exception 'You cannot trade with your own advertisement'; end if;
  if p_amount < v_ad.min_amount or p_amount > v_ad.max_amount then raise exception 'Amount is outside the advertised limits'; end if;

  -- Serialise on the seller's USDT balance and the escrow account to prevent concurrent over-escrow.
  perform pg_advisory_xact_lock(hashtext(v_seller::text || ':USDT'));
  perform pg_advisory_xact_lock(hashtext('SYSTEM_P2P_ESCROW_USDT'));

  select sandbox_mode, licensing_obtained into v_sandbox, v_licensed from system_config where id = true;
  if not v_sandbox and not v_licensed then raise exception 'Live financial operations are blocked until licensing is recorded'; end if;

  -- Idempotent replay: the same key must describe the same order.
  select * into v_existing from p2p_orders where initiated_by = p_buyer and idempotency_key = p_key;
  if found then
    if v_existing.advertisement_id <> p_ad or v_existing.amount <> p_amount then
      raise exception 'Idempotency key was already used for a different order';
    end if;
    return v_existing.id;
  end if;

  -- The seller must have a valid, active receiving account so the buyer knows where to pay PKR.
  if v_ad.payment_method_id is null
     or not exists(select 1 from payment_methods pm where pm.id = v_ad.payment_method_id and pm.user_id = v_seller and pm.active) then
    raise exception 'Seller has no active payment method configured';
  end if;

  v_price := v_ad.price;
  v_crypto := trunc(p_amount / v_price, 8);
  if v_crypto <= 0 then raise exception 'Amount is too small for the advertised price'; end if;

  select coalesce(sum(le.amount), 0) into v_balance
  from ledger_entries le join ledger_accounts la on la.id = le.ledger_account_id
  where la.owner_id = v_seller and la.asset_code = 'USDT';
  if v_balance < v_crypto then raise exception 'Seller has insufficient USDT to escrow this order'; end if;

  -- Lock: debit seller USDT, credit escrow. Balanced double entry.
  insert into ledger_entries(transaction_group_id, ledger_account_id, asset_code, amount)
    select v_group, id, 'USDT', -v_crypto from ledger_accounts where owner_id = v_seller and asset_code = 'USDT';
  insert into ledger_entries(transaction_group_id, ledger_account_id, asset_code, amount)
    select v_group, id, 'USDT', v_crypto from ledger_accounts where account_code = 'SYSTEM_P2P_ESCROW_USDT';
  if (select coalesce(sum(amount), 0) from ledger_entries where transaction_group_id = v_group) <> 0 then
    raise exception 'Escrow ledger transaction is unbalanced';
  end if;

  insert into p2p_orders(id, advertisement_id, buyer_id, seller_id, amount, price, crypto_amount, payment_method_id,
                         status, expires_at, initiated_by, idempotency_key, escrow_transaction_group_id)
  values (v_order, p_ad, p_buyer, v_seller, p_amount, v_price, v_crypto, v_ad.payment_method_id,
          'created', now() + make_interval(mins => v_ad.payment_window_minutes), p_buyer, p_key, v_group);

  -- Seller-facing history entry: USDT moved into escrow.
  insert into transactions(user_id, asset_code, amount, net_amount, type, status, reference, metadata)
  values (v_seller, 'USDT', v_crypto, -v_crypto, 'p2p_escrow_lock', 'completed', 'P2P-' || v_order || '-LOCK',
          jsonb_build_object('order_id', v_order, 'advertisement_id', p_ad));

  insert into audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (p_buyer, 'p2p.order.created', 'p2p_order', v_order::text,
          jsonb_build_object('seller_id', v_seller, 'amount_pkr', p_amount, 'crypto_usdt', v_crypto, 'price', v_price));

  return v_order;
end; $$;
revoke all on function public.create_p2p_sell_order(uuid, uuid, numeric, text) from public, authenticated, anon;
grant execute on function public.create_p2p_sell_order(uuid, uuid, numeric, text) to service_role;

-- 6. Buyer marks PKR as sent (moves no funds; only advances state and records proof).
create or replace function public.mark_p2p_payment_sent(p_order uuid, p_actor uuid, p_proof_path text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_order public.p2p_orders%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('p2p_order:' || p_order::text));
  select * into v_order from p2p_orders where id = p_order;
  if not found then raise exception 'Order not found'; end if;
  if v_order.buyer_id <> p_actor then raise exception 'Only the buyer can mark payment as sent'; end if;
  if v_order.status <> 'created' then raise exception 'Payment can only be marked from a newly created order'; end if;

  update p2p_orders
     set status = 'payment_sent',
         payment_sent_at = now(),
         payment_proof_path = coalesce(p_proof_path, payment_proof_path)
   where id = p_order;

  insert into audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (p_actor, 'p2p.payment.sent', 'p2p_order', p_order::text, jsonb_build_object('has_proof', p_proof_path is not null));
  return p_order;
end; $$;
revoke all on function public.mark_p2p_payment_sent(uuid, uuid, text) from public, authenticated, anon;
grant execute on function public.mark_p2p_payment_sent(uuid, uuid, text) to service_role;

-- 7. Internal release helper: move escrowed USDT to the buyer (minus an optional active p2p fee).
--    Reuses the order's existing escrow ledger group so the group nets to zero across lock + release.
create or replace function public.p2p_release_escrow_to_buyer(p_order public.p2p_orders)
returns void language plpgsql security definer set search_path = public as $$
declare v_fee public.fees%rowtype; v_fee_amount numeric(24,8); v_net numeric(24,8);
begin
  select * into v_fee from fees where operation = 'p2p' and asset_code = 'USDT' and active order by created_at desc limit 1;
  v_fee_amount := coalesce(v_fee.flat_amount, 0) + trunc(p_order.crypto_amount * coalesce(v_fee.percentage, 0) / 100, 8);
  if v_fee_amount < 0 or v_fee_amount >= p_order.crypto_amount then raise exception 'Invalid p2p fee configuration'; end if;
  v_net := p_order.crypto_amount - v_fee_amount;

  insert into ledger_entries(transaction_group_id, ledger_account_id, asset_code, amount)
    select p_order.escrow_transaction_group_id, id, 'USDT', -p_order.crypto_amount from ledger_accounts where account_code = 'SYSTEM_P2P_ESCROW_USDT';
  insert into ledger_entries(transaction_group_id, ledger_account_id, asset_code, amount)
    select p_order.escrow_transaction_group_id, id, 'USDT', v_net from ledger_accounts where owner_id = p_order.buyer_id and asset_code = 'USDT';
  if v_fee_amount > 0 then
    insert into ledger_entries(transaction_group_id, ledger_account_id, asset_code, amount)
      select p_order.escrow_transaction_group_id, id, 'USDT', v_fee_amount from ledger_accounts where account_code = 'SYSTEM_FEE_REVENUE_USDT';
  end if;
  if (select coalesce(sum(amount), 0) from ledger_entries where transaction_group_id = p_order.escrow_transaction_group_id) <> 0 then
    raise exception 'Release ledger transaction is unbalanced';
  end if;

  insert into transactions(user_id, asset_code, amount, fee, net_amount, type, status, reference, metadata)
  values (p_order.buyer_id, 'USDT', v_net, v_fee_amount, v_net, 'p2p_buy', 'completed', 'P2P-' || p_order.id || '-BUY',
          jsonb_build_object('order_id', p_order.id, 'seller_id', p_order.seller_id));
end; $$;
revoke all on function public.p2p_release_escrow_to_buyer(public.p2p_orders) from public, authenticated, anon;
grant execute on function public.p2p_release_escrow_to_buyer(public.p2p_orders) to service_role;

-- 8. Internal refund helper: return escrowed USDT to the seller.
create or replace function public.p2p_refund_escrow_to_seller(p_order public.p2p_orders)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into ledger_entries(transaction_group_id, ledger_account_id, asset_code, amount)
    select p_order.escrow_transaction_group_id, id, 'USDT', -p_order.crypto_amount from ledger_accounts where account_code = 'SYSTEM_P2P_ESCROW_USDT';
  insert into ledger_entries(transaction_group_id, ledger_account_id, asset_code, amount)
    select p_order.escrow_transaction_group_id, id, 'USDT', p_order.crypto_amount from ledger_accounts where owner_id = p_order.seller_id and asset_code = 'USDT';
  if (select coalesce(sum(amount), 0) from ledger_entries where transaction_group_id = p_order.escrow_transaction_group_id) <> 0 then
    raise exception 'Refund ledger transaction is unbalanced';
  end if;

  insert into transactions(user_id, asset_code, amount, net_amount, type, status, reference, metadata)
  values (p_order.seller_id, 'USDT', p_order.crypto_amount, p_order.crypto_amount, 'p2p_escrow_refund', 'completed', 'P2P-' || p_order.id || '-REFUND',
          jsonb_build_object('order_id', p_order.id));
end; $$;
revoke all on function public.p2p_refund_escrow_to_seller(public.p2p_orders) from public, authenticated, anon;
grant execute on function public.p2p_refund_escrow_to_seller(public.p2p_orders) to service_role;

-- 9. Seller confirms PKR receipt and releases escrowed USDT to the buyer.
create or replace function public.release_p2p_order(p_order uuid, p_actor uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_order public.p2p_orders%rowtype; v_sandbox boolean; v_licensed boolean;
begin
  perform pg_advisory_xact_lock(hashtext('p2p_order:' || p_order::text));
  perform pg_advisory_xact_lock(hashtext('SYSTEM_P2P_ESCROW_USDT'));
  select * into v_order from p2p_orders where id = p_order;
  if not found then raise exception 'Order not found'; end if;
  if v_order.seller_id <> p_actor then raise exception 'Only the seller can release escrowed funds'; end if;
  if v_order.status <> 'payment_sent' then raise exception 'Funds can only be released after the buyer marks payment as sent'; end if;

  select sandbox_mode, licensing_obtained into v_sandbox, v_licensed from system_config where id = true;
  if not v_sandbox and not v_licensed then raise exception 'Live financial operations are blocked until licensing is recorded'; end if;

  perform p2p_release_escrow_to_buyer(v_order);
  update p2p_orders set status = 'completed', completed_at = now() where id = p_order;

  insert into notifications(user_id, title, body) values
    (v_order.buyer_id, 'USDT received', 'Your P2P order completed and USDT was released to your wallet.'),
    (v_order.seller_id, 'Order completed', 'You released USDT for a completed P2P order.');
  insert into audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (p_actor, 'p2p.order.released', 'p2p_order', p_order::text, jsonb_build_object('buyer_id', v_order.buyer_id, 'crypto_usdt', v_order.crypto_amount));
  return p_order;
end; $$;
revoke all on function public.release_p2p_order(uuid, uuid) from public, authenticated, anon;
grant execute on function public.release_p2p_order(uuid, uuid) to service_role;

-- 10. Cancel a not-yet-paid order (either participant) and refund the seller's escrow.
create or replace function public.cancel_p2p_order(p_order uuid, p_actor uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_order public.p2p_orders%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('p2p_order:' || p_order::text));
  perform pg_advisory_xact_lock(hashtext('SYSTEM_P2P_ESCROW_USDT'));
  select * into v_order from p2p_orders where id = p_order;
  if not found then raise exception 'Order not found'; end if;
  if p_actor not in (v_order.buyer_id, v_order.seller_id) then raise exception 'Only a participant can cancel this order'; end if;
  if v_order.status <> 'created' then raise exception 'Only an unpaid order can be cancelled; open a dispute instead'; end if;

  perform p2p_refund_escrow_to_seller(v_order);
  update p2p_orders set status = 'cancelled', cancelled_at = now() where id = p_order;

  insert into audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (p_actor, 'p2p.order.cancelled', 'p2p_order', p_order::text, jsonb_build_object('crypto_usdt', v_order.crypto_amount));
  return p_order;
end; $$;
revoke all on function public.cancel_p2p_order(uuid, uuid) from public, authenticated, anon;
grant execute on function public.cancel_p2p_order(uuid, uuid) to service_role;

-- 11. Expire unpaid orders past their payment window (refund seller). Callable by the maintenance scheduler.
create or replace function public.expire_p2p_orders()
returns integer language plpgsql security definer set search_path = public as $$
declare v_order public.p2p_orders%rowtype; v_count integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('SYSTEM_P2P_ESCROW_USDT'));
  for v_order in select * from p2p_orders where status = 'created' and expires_at < now() for update loop
    perform p2p_refund_escrow_to_seller(v_order);
    update p2p_orders set status = 'expired', cancelled_at = now() where id = v_order.id;
    insert into notifications(user_id, title, body) values
      (v_order.buyer_id, 'Order expired', 'Your P2P order expired before payment was confirmed.'),
      (v_order.seller_id, 'Escrow refunded', 'An expired P2P order returned escrowed USDT to your wallet.');
    v_count := v_count + 1;
  end loop;
  return v_count;
end; $$;
revoke all on function public.expire_p2p_orders() from public, authenticated, anon;
grant execute on function public.expire_p2p_orders() to service_role;

-- 12. Open a dispute on a paid order (either participant). Freezes the order pending staff resolution.
create or replace function public.open_p2p_dispute(p_order uuid, p_actor uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_order public.p2p_orders%rowtype; v_dispute uuid := gen_random_uuid();
begin
  if p_reason is null or length(btrim(p_reason)) < 5 then raise exception 'A dispute reason is required'; end if;
  perform pg_advisory_xact_lock(hashtext('p2p_order:' || p_order::text));
  select * into v_order from p2p_orders where id = p_order;
  if not found then raise exception 'Order not found'; end if;
  if p_actor not in (v_order.buyer_id, v_order.seller_id) then raise exception 'Only a participant can open a dispute'; end if;
  if v_order.status <> 'payment_sent' then raise exception 'Disputes can only be opened after payment is marked sent'; end if;

  insert into disputes(id, order_id, opened_by, reason) values (v_dispute, p_order, p_actor, btrim(p_reason));
  update p2p_orders set status = 'disputed' where id = p_order;

  insert into audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (p_actor, 'p2p.dispute.opened', 'dispute', v_dispute::text, jsonb_build_object('order_id', p_order));
  return v_dispute;
end; $$;
revoke all on function public.open_p2p_dispute(uuid, uuid, text) from public, authenticated, anon;
grant execute on function public.open_p2p_dispute(uuid, uuid, text) to service_role;

-- 13. Staff dispute resolution: release to buyer or refund to seller. Permission checked against the passed admin id
--     (SECURITY DEFINER runs without auth.uid(), so we cannot rely on current_user_has_permission here).
create or replace function public.resolve_p2p_dispute(p_dispute uuid, p_admin uuid, p_outcome text, p_resolution text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_dispute public.disputes%rowtype; v_order public.p2p_orders%rowtype;
begin
  if p_outcome not in ('release_to_buyer', 'refund_to_seller') then raise exception 'Invalid dispute outcome'; end if;
  if p_resolution is null or length(btrim(p_resolution)) < 5 then raise exception 'A resolution note is required'; end if;
  if not exists(
    select 1 from admin_roles ar left join role_permissions rp on rp.role = ar.role
    where ar.user_id = p_admin and (ar.role = 'SUPER' or rp.permission_code = 'p2p.resolve')
  ) then raise exception 'Not authorised to resolve disputes'; end if;

  select * into v_dispute from disputes where id = p_dispute;
  if not found then raise exception 'Dispute not found'; end if;
  if v_dispute.status <> 'open' then raise exception 'Dispute is already resolved'; end if;

  perform pg_advisory_xact_lock(hashtext('p2p_order:' || v_dispute.order_id::text));
  perform pg_advisory_xact_lock(hashtext('SYSTEM_P2P_ESCROW_USDT'));
  select * into v_order from p2p_orders where id = v_dispute.order_id;
  if v_order.status <> 'disputed' then raise exception 'Order is not in a disputed state'; end if;

  if p_outcome = 'release_to_buyer' then
    perform p2p_release_escrow_to_buyer(v_order);
    update p2p_orders set status = 'completed', completed_at = now() where id = v_order.id;
  else
    perform p2p_refund_escrow_to_seller(v_order);
    update p2p_orders set status = 'cancelled', cancelled_at = now() where id = v_order.id;
  end if;

  update disputes set status = 'resolved', resolution = btrim(p_resolution), resolved_by = p_admin, resolved_at = now() where id = p_dispute;
  insert into notifications(user_id, title, body) values
    (v_order.buyer_id, 'Dispute resolved', 'A staff member resolved your P2P dispute.'),
    (v_order.seller_id, 'Dispute resolved', 'A staff member resolved your P2P dispute.');
  insert into audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (p_admin, 'p2p.dispute.resolved', 'dispute', p_dispute::text, jsonb_build_object('order_id', v_order.id, 'outcome', p_outcome));
  return p_dispute;
end; $$;
revoke all on function public.resolve_p2p_dispute(uuid, uuid, text, text) from public, authenticated, anon;
grant execute on function public.resolve_p2p_dispute(uuid, uuid, text, text) to service_role;

-- 14. Private bucket for buyer PKR-payment proof. Buyer uploads under <order_id>/..., both participants may read.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('p2p-payment-proofs', 'p2p-payment-proofs', false, 10485760, array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "buyers upload p2p payment proof" on storage.objects for insert to authenticated
  with check (bucket_id = 'p2p-payment-proofs' and exists(
    select 1 from public.p2p_orders o where o.id::text = (storage.foldername(name))[1] and o.buyer_id = auth.uid()
  ));
create policy "participants read p2p payment proof" on storage.objects for select to authenticated
  using (bucket_id = 'p2p-payment-proofs' and exists(
    select 1 from public.p2p_orders o where o.id::text = (storage.foldername(name))[1] and auth.uid() in (o.buyer_id, o.seller_id)
  ));
