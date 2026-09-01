-- Migration 015: Admin rate/fee management RPCs.
-- Forward-only. Safe to review before `supabase db push`.

-- 1. Admin: create a new rate (deactivates the previous active rate for that asset).
create or replace function public.admin_set_rate(
  p_asset public.asset_code,
  p_buy_rate numeric,
  p_sell_rate numeric,
  p_admin uuid
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_rate_id uuid := gen_random_uuid();
  v_next_version integer;
begin
  if p_buy_rate <= 0 or p_sell_rate <= 0 then
    raise exception 'Buy rate and sell rate must be positive';
  end if;

  -- Only SUPER or FINANCE admins can manage rates.
  if not exists(
    select 1 from admin_roles ar
    left join role_permissions rp on rp.role = ar.role
    where ar.user_id = p_admin and (ar.role = 'SUPER' or rp.permission_code = 'rates.manage')
  ) then
    raise exception 'Not authorised to manage rates';
  end if;

  -- Get the next version number.
  select coalesce(max(version), 0) + 1 into v_next_version from rates where asset_code = p_asset;

  -- Deactivate all existing rates for this asset.
  update rates set active = false where asset_code = p_asset and active = true;

  -- Insert the new rate.
  insert into rates(id, asset_code, buy_rate, sell_rate, version, active, created_by)
  values (v_rate_id, p_asset, p_buy_rate, p_sell_rate, v_next_version, true, p_admin);

  -- Audit log.
  insert into audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (p_admin, 'admin.rate.set', 'rate', v_rate_id::text,
          jsonb_build_object('asset', p_asset, 'buy_rate', p_buy_rate, 'sell_rate', p_sell_rate, 'version', v_next_version));

  return v_rate_id;
end; $$;

revoke all on function public.admin_set_rate(public.asset_code, numeric, numeric, uuid) from public, authenticated, anon;
grant execute on function public.admin_set_rate(public.asset_code, numeric, numeric, uuid) to service_role;

-- 2. Admin: get the current active rate for an asset.
create or replace function public.admin_get_current_rate(p_asset public.asset_code)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rate rates%rowtype;
begin
  select * into v_rate from rates where asset_code = p_asset and active = true order by version desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object('id', v_rate.id, 'asset_code', v_rate.asset_code, 'buy_rate', v_rate.buy_rate,
          'sell_rate', v_rate.sell_rate, 'version', v_rate.version, 'created_at', v_rate.created_at);
end; $$;

revoke all on function public.admin_get_current_rate(public.asset_code) from public, authenticated, anon;
grant execute on function public.admin_get_current_rate(public.asset_code) to service_role;
grant execute on function public.admin_get_current_rate(public.asset_code) to authenticated;

-- 3. Admin: set a fee for an operation+asset (deactivates the previous active fee).
create or replace function public.admin_set_fee(
  p_operation text,
  p_asset public.asset_code,
  p_flat_amount numeric,
  p_percentage numeric,
  p_admin uuid
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_fee_id uuid := gen_random_uuid();
begin
  if p_operation not in ('deposit', 'withdrawal', 'conversion', 'transfer', 'p2p') then
    raise exception 'Invalid operation';
  end if;
  if p_flat_amount < 0 or p_percentage < 0 or p_percentage > 100 then
    raise exception 'Invalid fee values';
  end if;

  -- Only SUPER or FINANCE admins can manage fees.
  if not exists(
    select 1 from admin_roles ar
    left join role_permissions rp on rp.role = ar.role
    where ar.user_id = p_admin and (ar.role = 'SUPER' or rp.permission_code = 'rates.manage')
  ) then
    raise exception 'Not authorised to manage fees';
  end if;

  -- Deactivate existing active fee for this operation+asset.
  update fees set active = false where operation = p_operation and asset_code = p_asset and active = true;

  -- Insert new fee.
  insert into fees(id, operation, asset_code, flat_amount, percentage, active, created_by)
  values (v_fee_id, p_operation, p_asset, p_flat_amount, p_percentage, true, p_admin);

  -- Audit log.
  insert into audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (p_admin, 'admin.fee.set', 'fee', v_fee_id::text,
          jsonb_build_object('operation', p_operation, 'asset', p_asset, 'flat_amount', p_flat_amount, 'percentage', p_percentage));

  return v_fee_id;
end; $$;

revoke all on function public.admin_set_fee(text, public.asset_code, numeric, numeric, uuid) from public, authenticated, anon;
grant execute on function public.admin_set_fee(text, public.asset_code, numeric, numeric, uuid) to service_role;

-- 4. Admin: get all current active fees.
create or replace function public.admin_get_current_fees()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  return (
    select jsonb_agg(jsonb_build_object(
      'id', f.id, 'operation', f.operation, 'asset_code', f.asset_code,
      'flat_amount', f.flat_amount, 'percentage', f.percentage, 'created_at', f.created_at
    ))
    from fees f where f.active = true order by f.operation, f.asset_code
  );
end; $$;

revoke all on function public.admin_get_current_fees() from public, authenticated, anon;
grant execute on function public.admin_get_current_fees() to service_role;
grant execute on function public.admin_get_current_fees() to authenticated;
