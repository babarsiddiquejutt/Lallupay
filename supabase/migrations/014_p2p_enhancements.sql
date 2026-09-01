-- Phase 3a: P2P enhancements — payment methods, discount, ranking, seller stats.
-- Migration 014. Forward-only. Safe to review before `supabase db push`.

-- 1. Expand supported payment methods: add nayapay and cashmaal.
--    The payment_methods table uses a text method_type, so we update the
--    existing CHECK constraint via a new one (the old one is inherited from
--    migration 004 or 006). We use the simplest safe approach: drop old
--    constraint, add new one with all 5 methods.
DO $$
BEGIN
  -- Drop existing check constraints on payment_methods.method_type
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_methods_method_type_check') THEN
    ALTER TABLE public.payment_methods DROP CONSTRAINT payment_methods_method_type_check;
  END IF;
  -- Also check for the constraint that may exist without a standard name
  PERFORM 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE t.relname = 'payment_methods' AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%method_type%';
  -- Add the expanded constraint.
  ALTER TABLE public.payment_methods
    ADD CONSTRAINT payment_methods_method_type_check
    CHECK (method_type IN ('bank', 'jazzcash', 'easypaisa', 'nayapay', 'cashmaal'));
END $$;

-- 2. P2P discount: seller may offer a percentage discount on their advertisement.
--    discount_percent = 0 means no discount (full price).
alter table public.p2p_advertisements
  add column if not exists discount_percent numeric(5,2) not null default 0
  check (discount_percent >= 0 and discount_percent <= 50);

-- Snapshot the discount into the order so ad edits never alter in-flight orders.
alter table public.p2p_orders
  add column if not exists discount_percent numeric(5,2) not null default 0;

-- 3. Seller reputation summary: computed on-demand, not stored.
--    We create a function that returns seller stats for ranking.

-- 4. Seller online/offline: track the last activity timestamp.
alter table public.profiles
  add column if not exists last_active_at timestamptz not null default now();

-- 5. Seller advertisement ranking function.
--    Ranking criteria (deterministic, weighted):
--      1. Higher discount (most important for buyer value)
--      2. Lower effective price (after discount)
--      3. Higher available amount (max_amount)
--      4. Higher seller reputation score
--      5. Higher 30-day completion rate
--      6. More fulfilled orders (30-day)
create or replace function public.get_ranked_sell_advertisements()
returns table (
  id uuid,
  owner_id uuid,
  price numeric,
  min_amount numeric,
  max_amount numeric,
  discount_percent numeric,
  effective_price numeric,
  payment_window_minutes integer,
  payment_method_id uuid,
  seller_last_active timestamptz,
  seller_30d_completed integer,
  seller_30d_total integer,
  seller_30d_rate numeric,
  seller_avg_rating numeric
) language plpgsql stable security definer set search_path = public as $$
begin
  return query
  select
    ad.id,
    ad.owner_id,
    ad.price,
    ad.min_amount,
    ad.max_amount,
    ad.discount_percent,
    (ad.price * (1 - ad.discount_percent / 100))::numeric(18,6) as effective_price,
    ad.payment_window_minutes,
    ad.payment_method_id,
    p.last_active_at,
    -- 30-day completed orders as seller
    (select count(*)::integer from p2p_orders o
     where o.seller_id = ad.owner_id and o.status = 'completed'
       and o.completed_at > now() - interval '30 days') as seller_30d_completed,
    -- 30-day total orders (completed + cancelled + disputed) as seller
    (select count(*)::integer from p2p_orders o
     where o.seller_id = ad.owner_id
       and o.status in ('completed', 'cancelled', 'disputed')
       and o.created_at > now() - interval '30 days') as seller_30d_total,
    -- 30-day completion rate
    case
      when (select count(*) from p2p_orders o
            where o.seller_id = ad.owner_id
              and o.status in ('completed', 'cancelled', 'disputed')
              and o.created_at > now() - interval '30 days') = 0 then 0
      else (select count(*)::numeric from p2p_orders o
            where o.seller_id = ad.owner_id and o.status = 'completed'
              and o.completed_at > now() - interval '30 days')
           / (select count(*)::numeric from p2p_orders o
              where o.seller_id = ad.owner_id
                and o.status in ('completed', 'cancelled', 'disputed')
                and o.created_at > now() - interval '30 days')
    end as seller_30d_rate,
    -- Average rating
    coalesce((select avg(r.rating)::numeric(3,2) from p2p_reputation r
              where r.reviewed_user_id = ad.owner_id), 0) as seller_avg_rating
  from p2p_advertisements ad
  join profiles p on p.id = ad.owner_id
  where ad.status = 'active' and ad.side = 'sell'
  order by
    -- Higher discount first
    ad.discount_percent desc,
    -- Lower effective price first
    (ad.price * (1 - ad.discount_percent / 100)) asc,
    -- Higher max_amount first
    ad.max_amount desc,
    -- Higher reputation first
    coalesce((select avg(r.rating) from p2p_reputation r where r.reviewed_user_id = ad.owner_id), 0) desc,
    -- Higher 30-day completion rate
    case
      when (select count(*) from p2p_orders o
            where o.seller_id = ad.owner_id
              and o.status in ('completed', 'cancelled', 'disputed')
              and o.created_at > now() - interval '30 days') = 0 then 0
      else (select count(*)::numeric from p2p_orders o
            where o.seller_id = ad.owner_id and o.status = 'completed'
              and o.completed_at > now() - interval '30 days')
           / (select count(*)::numeric from p2p_orders o
              where o.seller_id = ad.owner_id
                and o.status in ('completed', 'cancelled', 'disputed')
                and o.created_at > now() - interval '30 days')
    end desc,
    -- More fulfilled orders
    (select count(*) from p2p_orders o
     where o.seller_id = ad.owner_id and o.status = 'completed'
       and o.completed_at > now() - interval '30 days') desc;
end; $$;

revoke all on function public.get_ranked_sell_advertisements() from public, authenticated, anon;
grant execute on function public.get_ranked_sell_advertisements() to anon, authenticated, service_role;

-- 6. Seller stats function: returns stats for a specific seller.
create or replace function public.get_seller_stats(p_seller uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_completed integer;
  v_total integer;
  v_rate numeric;
  v_avg_rating numeric;
  v_total_reviews integer;
begin
  select count(*) into v_completed from p2p_orders
    where seller_id = p_seller and status = 'completed' and completed_at > now() - interval '30 days';
  select count(*) into v_total from p2p_orders
    where seller_id = p_seller and status in ('completed', 'cancelled', 'disputed')
      and created_at > now() - interval '30 days';
  v_rate := case when v_total = 0 then 0 else v_completed::numeric / v_total end;
  select avg(rating)::numeric(3,2), count(*) into v_avg_rating, v_total_reviews
    from p2p_reputation where reviewed_user_id = p_seller;

  return jsonb_build_object(
    'completed_30d', v_completed,
    'total_30d', v_total,
    'completion_rate', v_rate,
    'avg_rating', coalesce(v_avg_rating, 0),
    'total_reviews', coalesce(v_total_reviews, 0)
  );
end; $$;

revoke all on function public.get_seller_stats(uuid) from public, authenticated, anon;
grant execute on function public.get_seller_stats(uuid) to anon, authenticated, service_role;

-- 7. Heartbeat: update seller's last_active_at.
create or replace function public.update_seller_heartbeat(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update profiles set last_active_at = now() where id = p_user;
end; $$;

revoke all on function public.update_seller_heartbeat(uuid) from public, authenticated, anon;
grant execute on function public.update_seller_heartbeat(uuid) to authenticated, service_role;

-- 8. Auto-offline sellers inactive for >60 minutes (called by scheduled maintenance).
create or replace function public.offline_inactive_sellers()
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer := 0;
begin
  update p2p_advertisements ad
  set status = 'paused'
  from profiles p
  where ad.owner_id = p.id
    and ad.status = 'active'
    and p.last_active_at < now() - interval '60 minutes';
  get diagnostics v_count = row_count;
  return v_count;
end; $$;

revoke all on function public.offline_inactive_sellers() from public, authenticated, anon;
grant execute on function public.offline_inactive_sellers() to service_role;

-- 9. Fix the create_p2p_sell_order to snapshot discount_percent into the order.
--    The existing function doesn't snapshot it, so we update it.
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
  v_discount numeric(5,2);
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

  perform pg_advisory_xact_lock(hashtext(v_seller::text || ':USDT'));
  perform pg_advisory_xact_lock(hashtext('SYSTEM_P2P_ESCROW_USDT'));

  select sandbox_mode, licensing_obtained into v_sandbox, v_licensed from system_config where id = true;
  if not v_sandbox and not v_licensed then raise exception 'Live financial operations are blocked until licensing is recorded'; end if;

  select * into v_existing from p2p_orders where initiated_by = p_buyer and idempotency_key = p_key;
  if found then
    if v_existing.advertisement_id <> p_ad or v_existing.amount <> p_amount then
      raise exception 'Idempotency key was already used for a different order';
    end if;
    return v_existing.id;
  end if;

  if v_ad.payment_method_id is null
     or not exists(select 1 from payment_methods pm where pm.id = v_ad.payment_method_id and pm.user_id = v_seller and pm.active) then
    raise exception 'Seller has no active payment method configured';
  end if;

  v_price := v_ad.price;
  v_discount := v_ad.discount_percent;
  v_crypto := trunc(p_amount / v_price, 8);
  if v_crypto <= 0 then raise exception 'Amount is too small for the advertised price'; end if;

  select coalesce(sum(le.amount), 0) into v_balance
  from ledger_entries le join ledger_accounts la on la.id = le.ledger_account_id
  where la.owner_id = v_seller and la.asset_code = 'USDT';
  if v_balance < v_crypto then raise exception 'Seller has insufficient USDT to escrow this order'; end if;

  insert into ledger_entries(transaction_group_id, ledger_account_id, asset_code, amount)
    select v_group, id, 'USDT', -v_crypto from ledger_accounts where owner_id = v_seller and asset_code = 'USDT';
  insert into ledger_entries(transaction_group_id, ledger_account_id, asset_code, amount)
    select v_group, id, 'USDT', v_crypto from ledger_accounts where account_code = 'SYSTEM_P2P_ESCROW_USDT';
  if (select coalesce(sum(amount), 0) from ledger_entries where transaction_group_id = v_group) <> 0 then
    raise exception 'Escrow ledger transaction is unbalanced';
  end if;

  insert into p2p_orders(id, advertisement_id, buyer_id, seller_id, amount, price, crypto_amount, payment_method_id,
                         status, expires_at, initiated_by, idempotency_key, escrow_transaction_group_id, discount_percent)
  values (v_order, p_ad, p_buyer, v_seller, p_amount, v_price, v_crypto, v_ad.payment_method_id,
          'created', now() + make_interval(mins => v_ad.payment_window_minutes), p_buyer, v_key, v_group, v_discount);

  insert into transactions(user_id, asset_code, amount, net_amount, type, status, reference, metadata)
  values (v_seller, 'USDT', v_crypto, -v_crypto, 'p2p_escrow_lock', 'completed', 'P2P-' || v_order || '-LOCK',
          jsonb_build_object('order_id', v_order, 'advertisement_id', p_ad, 'discount_percent', v_discount));

  insert into audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (p_buyer, 'p2p.order.created', 'p2p_order', v_order::text,
          jsonb_build_object('seller_id', v_seller, 'amount_pkr', p_amount, 'crypto_usdt', v_crypto, 'price', v_price, 'discount_percent', v_discount));

  return v_order;
end; $$;
revoke all on function public.create_p2p_sell_order(uuid, uuid, numeric, text) from public, authenticated, anon;
grant execute on function public.create_p2p_sell_order(uuid, uuid, numeric, text) to service_role;

-- 10. Review submission with duplicate prevention.
create or replace function public.submit_p2p_review(
  p_order uuid, p_reviewer uuid, p_reviewed_user uuid, p_rating smallint, p_comment text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_review uuid := gen_random_uuid(); v_order public.p2p_orders%rowtype;
begin
  if p_rating < 1 or p_rating > 5 then raise exception 'Rating must be between 1 and 5'; end if;
  if p_comment is not null and length(p_comment) > 500 then raise exception 'Review comment must be 500 characters or less'; end if;

  select * into v_order from p2p_orders where id = p_order;
  if not found then raise exception 'Order not found'; end if;
  if v_order.status <> 'completed' then raise exception 'Reviews can only be submitted for completed orders'; end if;
  if p_reviewer not in (v_order.buyer_id, v_order.seller_id) then raise exception 'Only order participants can leave reviews'; end if;
  if p_reviewed_user not in (v_order.buyer_id, v_order.seller_id) then raise exception 'Can only review order participants'; end if;
  if p_reviewer = p_reviewed_user then raise exception 'Cannot review yourself'; end if;
  if exists(select 1 from p2p_reputation where order_id = p_order and reviewer_id = p_reviewer) then
    raise exception 'You have already reviewed this order';
  end if;

  insert into p2p_reputation(order_id, reviewer_id, reviewed_user_id, rating, comment)
  values (p_order, p_reviewer, p_reviewed_user, p_rating, p_comment);

  insert into audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (p_reviewer, 'p2p.review.submitted', 'p2p_order', p_order::text,
          jsonb_build_object('reviewed_user', p_reviewed_user, 'rating', p_rating));

  return v_review;
end; $$;
revoke all on function public.submit_p2p_review(uuid, uuid, uuid, smallint, text) from public, authenticated, anon;
grant execute on function public.submit_p2p_review(uuid, uuid, uuid, smallint, text) to service_role;

-- 11. Update the scheduled maintenance to also auto-offline sellers.
--     The existing expire_p2p_orders already runs; we add the seller offline check.
--     This is called from the same scheduled-maintenance Edge Function.
--     (Added as a separate RPC; the Edge Function will call both.)
