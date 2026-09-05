-- Migration 018: P2P BUY order support.
-- Adds crypto_amount to advertisements for BUY ads, creates create_p2p_buy_order RPC,
-- and creates create_buy_advertisement helper function.
-- Forward-only. Safe to review before `supabase db push`.

-- 1. Add crypto_amount to advertisements (for BUY ads: how much USDT the buyer wants).
--    For SELL ads this is NULL (seller's USDT is checked at order time, not ad time).
alter table public.p2p_advertisements add column if not exists crypto_amount numeric(24,8);

-- 2. Create a BUY advertisement (RLS enforces owner_id = auth.uid()).
--    For BUY ads: asset_code = 'USDT', crypto_amount = desired USDT, price = PKR per USDT.
create or replace function public.create_buy_advertisement(
  p_owner uuid,
  p_price numeric,
  p_crypto_amount numeric,
  p_min_amount numeric,
  p_max_amount numeric,
  p_payment_method_id uuid,
  p_payment_window_minutes integer
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_ad uuid := gen_random_uuid();
begin
  if p_price <= 0 then raise exception 'Price must be positive'; end if;
  if p_crypto_amount <= 0 then raise exception 'USDT amount must be positive'; end if;
  if p_min_amount <= 0 or p_max_amount < p_min_amount then raise exception 'Invalid order limits'; end if;
  if p_payment_window_minutes < 5 or p_payment_window_minutes > 1440 then raise exception 'Payment window must be 5–1440 minutes'; end if;
  if not exists(select 1 from payment_methods where id = p_payment_method_id and user_id = p_owner and active) then
    raise exception 'Invalid or inactive payment method';
  end if;

  insert into p2p_advertisements(
    id, owner_id, side, asset_code, price, crypto_amount, min_amount, max_amount,
    status, payment_method_id, payment_window_minutes
  ) values (
    v_ad, p_owner, 'buy', 'USDT', p_price, p_crypto_amount, p_min_amount, p_max_amount,
    'active', p_payment_method_id, p_payment_window_minutes
  );

  insert into audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (p_owner, 'p2p.ad.created', 'p2p_advertisement', v_ad::text,
          jsonb_build_object('side', 'buy', 'price', p_price, 'crypto_amount', p_crypto_amount));

  return v_ad;
end; $$;

revoke all on function public.create_buy_advertisement(uuid, numeric, numeric, numeric, numeric, uuid, integer) from public, authenticated, anon;
grant execute on function public.create_buy_advertisement(uuid, numeric, numeric, numeric, numeric, uuid, integer) to service_role;

-- 3. Create a USDT buy order and atomically lock the buyer's USDT into escrow.
--    For BUY ads: the buyer offers to buy USDT at a given PKR price.
--    When a seller takes this ad, the buyer's USDT is escrowed.
--    The seller then sends PKR directly to the buyer off-platform.
--    After PKR confirmation, escrowed USDT is released to the seller.
create or replace function public.create_p2p_buy_order(
  p_ad uuid,
  p_seller uuid,
  p_amount numeric,
  p_key text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_ad public.p2p_advertisements%rowtype;
  v_existing public.p2p_orders%rowtype;
  v_order uuid := gen_random_uuid();
  v_group uuid := gen_random_uuid();
  v_buyer uuid;
  v_price numeric(18,6);
  v_crypto numeric(24,8);
  v_balance numeric;
  v_sandbox boolean;
  v_licensed boolean;
begin
  if p_key is null or length(p_key) < 16 then raise exception 'A valid idempotency key is required'; end if;
  if p_amount is null or p_amount <= 0 or scale(p_amount) > 8 then raise exception 'Invalid USDT amount'; end if;

  select * into v_ad from p2p_advertisements where id = p_ad;
  if not found then raise exception 'Advertisement not found'; end if;
  if v_ad.side <> 'buy' then raise exception 'Only buy advertisements can be taken with this function'; end if;
  if v_ad.status <> 'active' then raise exception 'Advertisement is not active'; end if;

  v_buyer := v_ad.owner_id;
  if v_buyer = p_seller then raise exception 'You cannot trade with your own advertisement'; end if;
  if p_amount < v_ad.min_amount or p_amount > v_ad.max_amount then raise exception 'Amount is outside the advertised limits'; end if;

  -- Serialise on the buyer's USDT balance and the escrow account.
  perform pg_advisory_xact_lock(hashtext(v_buyer::text || ':USDT'));
  perform pg_advisory_xact_lock(hashtext('SYSTEM_P2P_ESCROW_USDT'));

  select sandbox_mode, licensing_obtained into v_sandbox, v_licensed from system_config where id = true;
  if not v_sandbox and not v_licensed then raise exception 'Live financial operations are blocked until licensing is recorded'; end if;

  -- Idempotent replay.
  select * into v_existing from p2p_orders where initiated_by = p_seller and idempotency_key = p_key;
  if found then
    if v_existing.advertisement_id <> p_ad or v_existing.amount <> p_amount then
      raise exception 'Idempotency key was already used for a different order';
    end if;
    return v_existing.id;
  end if;

  -- Seller must have an active payment method so the buyer knows where to send PKR.
  if not exists(select 1 from payment_methods pm where pm.user_id = p_seller and pm.active) then
    raise exception 'Seller has no active payment method configured';
  end if;

  v_price := v_ad.price;
  v_crypto := p_amount;
  if v_crypto <= 0 then raise exception 'Amount is too small'; end if;

  -- Check buyer's USDT balance.
  select coalesce(sum(le.amount), 0) into v_balance
  from ledger_entries le join ledger_accounts la on la.id = le.ledger_account_id
  where la.owner_id = v_buyer and la.asset_code = 'USDT';
  if v_balance < v_crypto then raise exception 'Buyer has insufficient USDT to escrow this order'; end if;

  -- Lock: debit buyer USDT, credit escrow. Balanced double entry.
  insert into ledger_entries(transaction_group_id, ledger_account_id, asset_code, amount)
    select v_group, id, 'USDT', -v_crypto from ledger_accounts where owner_id = v_buyer and asset_code = 'USDT';
  insert into ledger_entries(transaction_group_id, ledger_account_id, asset_code, amount)
    select v_group, id, 'USDT', v_crypto from ledger_accounts where account_code = 'SYSTEM_P2P_ESCROW_USDT';
  if (select coalesce(sum(amount), 0) from ledger_entries where transaction_group_id = v_group) <> 0 then
    raise exception 'Escrow ledger transaction is unbalanced';
  end if;

  -- Get the seller's payment method for PKR payment.
  declare v_seller_pm uuid;
  begin
    select id into v_seller_pm from payment_methods where user_id = p_seller and active order by created_at desc limit 1;
    if v_seller_pm is null then raise exception 'Seller has no active payment method'; end if;

    insert into p2p_orders(id, advertisement_id, buyer_id, seller_id, amount, price, crypto_amount, payment_method_id,
                           status, expires_at, initiated_by, idempotency_key, escrow_transaction_group_id)
    values (v_order, p_ad, v_buyer, p_seller, v_ad.min_amount, v_price, v_crypto, v_seller_pm,
            'created', now() + make_interval(mins => v_ad.payment_window_minutes), p_seller, p_key, v_group);
  end;

  -- Buyer-facing history entry: USDT moved into escrow.
  insert into transactions(user_id, asset_code, amount, net_amount, type, status, reference, metadata)
  values (v_buyer, 'USDT', v_crypto, -v_crypto, 'p2p_escrow_lock', 'completed', 'P2P-' || v_order || '-LOCK',
          jsonb_build_object('order_id', v_order, 'advertisement_id', p_ad, 'side', 'buy'));

  insert into audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (p_seller, 'p2p.order.created', 'p2p_order', v_order::text,
          jsonb_build_object('buyer_id', v_buyer, 'amount_usdt', v_crypto, 'price', v_price, 'side', 'buy'));

  return v_order;
end; $$;

revoke all on function public.create_p2p_buy_order(uuid, uuid, numeric, text) from public, authenticated, anon;
grant execute on function public.create_p2p_buy_order(uuid, uuid, numeric, text) to service_role;
