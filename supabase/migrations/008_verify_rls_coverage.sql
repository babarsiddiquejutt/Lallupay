-- Fail migration application if any LaluPay application table is accidentally left without RLS.
do $$
declare missing_tables text;
begin
  select string_agg(expected.table_name, ', ' order by expected.table_name)
  into missing_tables
  from unnest(array[
    'admin_roles','aml_risk_flags','aml_screening_results','app_releases','assets','audit_logs','compliance_reports',
    'conversions','deposits','deposit_addresses','device_sessions','disputes','fees','idempotency_keys','kyc_documents',
    'kyc_submissions','ledger_accounts','ledger_entries','networks','notifications','order_messages','partner_api_keys',
    'payment_methods','p2p_advertisements','p2p_orders','p2p_reputation','permissions','profiles','rates','reconciliation_reports',
    'role_permissions','system_config','transactions','transfers','two_factor_credentials','webhook_deliveries','wallets','withdrawals'
  ]) as expected(table_name)
  left join pg_class relation on relation.relname = expected.table_name and relation.relkind = 'r' and relation.relnamespace = 'public'::regnamespace
  where relation.oid is null or not relation.relrowsecurity;

  if missing_tables is not null then
    raise exception 'RLS must be enabled before deployment. Missing: %', missing_tables;
  end if;
end;
$$;
