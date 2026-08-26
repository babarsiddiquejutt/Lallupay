-- Server-authoritative PKR <-> USDT conversion with idempotency and ledger-backed execution.
alter table public.conversions add column if not exists transaction_group_id uuid unique;
alter table public.conversions add column if not exists idempotency_key text;
alter table public.conversions add column if not exists fee_asset public.asset_code;
create unique index conversions_user_idempotency_idx on public.conversions(user_id, idempotency_key) where idempotency_key is not null;

insert into public.ledger_accounts(owner_id, asset_code, account_code) values
  (null, 'PKR', 'SYSTEM_PKR_POOL'), (null, 'USDT', 'SYSTEM_USDT_POOL'),
  (null, 'PKR', 'SYSTEM_FEE_REVENUE_PKR'), (null, 'USDT', 'SYSTEM_FEE_REVENUE_USDT')
on conflict (account_code) do nothing;

create or replace function public.quote_conversion(p_from public.asset_code, p_to public.asset_code, p_amount numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rate public.rates%rowtype; v_fee public.fees%rowtype; v_gross numeric(24,8); v_fee_amount numeric(24,8); v_net numeric(24,8);
begin
  if p_amount <= 0 or scale(p_amount) > 8 or not ((p_from = 'PKR' and p_to = 'USDT') or (p_from = 'USDT' and p_to = 'PKR')) then raise exception 'Unsupported conversion pair'; end if;
  select * into v_rate from rates where asset_code = 'USDT' and active order by version desc limit 1;
  if not found then raise exception 'No active conversion rate is available'; end if;
  v_gross := case when p_from = 'PKR' then trunc(p_amount / v_rate.buy_rate, 8) else trunc(p_amount * v_rate.sell_rate, 2) end;
  select * into v_fee from fees where operation = 'conversion' and asset_code = p_to and active order by created_at desc limit 1;
  v_fee_amount := coalesce(v_fee.flat_amount, 0) + trunc(v_gross * coalesce(v_fee.percentage, 0) / 100, case when p_to = 'PKR' then 2 else 8 end);
  v_net := v_gross - v_fee_amount;
  if v_net <= 0 then raise exception 'Conversion amount is too small after fees'; end if;
  return jsonb_build_object('rate_id', v_rate.id, 'rate', case when p_from = 'PKR' then v_rate.buy_rate else v_rate.sell_rate end, 'gross_amount', v_gross, 'fee', v_fee_amount, 'net_amount', v_net, 'fee_asset', p_to);
end; $$;

create or replace function public.execute_conversion(p_user uuid, p_from public.asset_code, p_to public.asset_code, p_amount numeric, p_key text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_quote jsonb; v_group uuid := gen_random_uuid(); v_conversion uuid := gen_random_uuid(); v_existing public.conversions%rowtype; v_balance numeric; v_pool_balance numeric; v_gross numeric; v_fee numeric; v_net numeric; v_rate uuid; v_sandbox boolean; v_licensed boolean;
begin
  if p_key is null or length(p_key) < 16 or p_amount <= 0 or scale(p_amount) > 8 then raise exception 'Invalid conversion request'; end if;
  perform pg_advisory_xact_lock(hashtext(p_user::text || ':' || p_from::text));
  perform pg_advisory_xact_lock(hashtext('SYSTEM_' || p_to || '_POOL'));
  select sandbox_mode, licensing_obtained into v_sandbox, v_licensed from system_config where id = true;
  if not v_sandbox and not v_licensed then raise exception 'Live financial operations are blocked until licensing is recorded'; end if;
  select * into v_existing from conversions where user_id = p_user and idempotency_key = p_key;
  if found then if v_existing.from_asset <> p_from or v_existing.to_asset <> p_to or v_existing.source_amount <> p_amount then raise exception 'Idempotency key was already used for a different conversion'; end if; return v_existing.id; end if;
  v_quote := quote_conversion(p_from, p_to, p_amount); v_rate := (v_quote->>'rate_id')::uuid; v_gross := (v_quote->>'gross_amount')::numeric; v_fee := (v_quote->>'fee')::numeric; v_net := (v_quote->>'net_amount')::numeric;
  select coalesce(sum(le.amount),0) into v_balance from ledger_entries le join ledger_accounts la on la.id = le.ledger_account_id where la.owner_id = p_user and la.asset_code = p_from;
  if v_balance < p_amount then raise exception 'Insufficient funds'; end if;
  select coalesce(sum(le.amount),0) into v_pool_balance from ledger_entries le join ledger_accounts la on la.id = le.ledger_account_id where la.account_code = 'SYSTEM_' || p_to || '_POOL';
  if v_pool_balance < v_gross then raise exception 'Insufficient system liquidity'; end if;
  insert into ledger_entries(transaction_group_id,ledger_account_id,asset_code,amount) select v_group,id,p_from,-p_amount from ledger_accounts where owner_id=p_user and asset_code=p_from;
  insert into ledger_entries(transaction_group_id,ledger_account_id,asset_code,amount) select v_group,id,p_from,p_amount from ledger_accounts where account_code='SYSTEM_'||p_from||'_POOL';
  insert into ledger_entries(transaction_group_id,ledger_account_id,asset_code,amount) select v_group,id,p_to,-v_gross from ledger_accounts where account_code='SYSTEM_'||p_to||'_POOL';
  insert into ledger_entries(transaction_group_id,ledger_account_id,asset_code,amount) select v_group,id,p_to,v_net from ledger_accounts where owner_id=p_user and asset_code=p_to;
  if v_fee > 0 then insert into ledger_entries(transaction_group_id,ledger_account_id,asset_code,amount) select v_group,id,p_to,v_fee from ledger_accounts where account_code='SYSTEM_FEE_REVENUE_'||p_to; end if;
  insert into conversions(id,user_id,from_asset,to_asset,source_amount,rate,fee,net_amount,rate_id,transaction_group_id,idempotency_key,fee_asset) values(v_conversion,p_user,p_from,p_to,p_amount,(v_quote->>'rate')::numeric,v_fee,v_net,v_rate,v_group,p_key,p_to);
  insert into transactions(user_id,asset_code,amount,fee,net_amount,type,status,reference,metadata) values(p_user,p_from,p_amount,0,-p_amount,'conversion_out','completed','CNV-'||v_conversion,jsonb_build_object('conversion_id',v_conversion)),(p_user,p_to,v_gross,v_fee,v_net,'conversion_in','completed','CNV-'||v_conversion||'-IN',jsonb_build_object('conversion_id',v_conversion));
  insert into audit_logs(actor_id,action,entity_type,entity_id,metadata) values(p_user,'conversion.executed','conversion',v_conversion::text,v_quote);
  return v_conversion;
end; $$;
revoke all on function public.quote_conversion(public.asset_code,public.asset_code,numeric) from public;
revoke all on function public.execute_conversion(uuid,public.asset_code,public.asset_code,numeric,text) from public;
