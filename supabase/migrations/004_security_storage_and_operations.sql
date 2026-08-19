-- Reproducible Supabase Storage configuration. Both buckets are private by default.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('kyc-documents', 'kyc-documents', false, 10485760, array['image/jpeg', 'image/png', 'application/pdf']),
  ('app-releases', 'app-releases', false, 104857600, array['application/vnd.android.package-archive', 'application/octet-stream'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create table public.kyc_submissions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete restrict,
  status public.kyc_state not null default 'pending', rejection_reason text, reviewed_by uuid references public.profiles,
  reviewed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index kyc_submissions_user_created_idx on public.kyc_submissions(user_id, created_at desc);
create table public.kyc_documents (
  id uuid primary key default gen_random_uuid(), submission_id uuid not null references public.kyc_submissions on delete cascade,
  user_id uuid not null references public.profiles on delete restrict, storage_path text not null unique,
  document_type text not null check(document_type in ('national_id_front','national_id_back','selfie','proof_of_address')),
  created_at timestamptz not null default now(), unique(submission_id, document_type)
);
create table public.two_factor_credentials (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade,
  secret_ciphertext text not null, enabled_at timestamptz, created_at timestamptz not null default now(), unique(user_id)
);
create table public.device_sessions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade,
  session_hash text not null unique, device_label text, last_seen_at timestamptz not null default now(), revoked_at timestamptz, created_at timestamptz not null default now()
);
create table public.deposits (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles, asset_code public.asset_code not null,
  amount numeric(24,8) not null check(amount > 0), network text, txid text, payment_method text, proof_path text,
  status public.tx_status not null default 'pending', reviewed_by uuid references public.profiles, reviewed_at timestamptz,
  created_at timestamptz not null default now(), unique(network, txid)
);
create index deposits_user_created_idx on public.deposits(user_id, created_at desc);
create table public.withdrawals (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles, asset_code public.asset_code not null,
  amount numeric(24,8) not null check(amount > 0), fee numeric(24,8) not null default 0 check(fee >= 0), destination text not null,
  status public.tx_status not null default 'pending', reviewed_by uuid references public.profiles, reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index withdrawals_user_created_idx on public.withdrawals(user_id, created_at desc);
create table public.rates (
  id uuid primary key default gen_random_uuid(), asset_code public.asset_code not null, buy_rate numeric(18,6) not null check(buy_rate > 0),
  sell_rate numeric(18,6) not null check(sell_rate > 0), version integer not null, active boolean not null default true,
  created_by uuid references public.profiles, created_at timestamptz not null default now(), unique(asset_code, version)
);
create unique index rates_one_active_per_asset_idx on public.rates(asset_code) where active;
create table public.conversions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles, from_asset public.asset_code not null,
  to_asset public.asset_code not null, source_amount numeric(24,8) not null check(source_amount > 0), rate numeric(18,6) not null check(rate > 0),
  fee numeric(24,8) not null default 0 check(fee >= 0), net_amount numeric(24,8) not null, rate_id uuid references public.rates,
  created_at timestamptz not null default now(), check(from_asset <> to_asset)
);
create index conversions_user_created_idx on public.conversions(user_id, created_at desc);
create table public.payment_methods (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade,
  method_type text not null check(method_type in ('bank','jazzcash','easypaisa')), account_name text not null,
  account_reference_masked text not null, encrypted_details text not null, active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.disputes (
  id uuid primary key default gen_random_uuid(), order_id uuid not null unique references public.p2p_orders on delete restrict,
  opened_by uuid not null references public.profiles, reason text not null check(length(reason) between 5 and 2000),
  status text not null default 'open' check(status in ('open','resolved','rejected')), resolution text,
  resolved_by uuid references public.profiles, resolved_at timestamptz, created_at timestamptz not null default now()
);
create table public.admin_roles (user_id uuid primary key references public.profiles on delete cascade, role text not null check(role in ('SUPER','FINANCE','KYC','SUPPORT','P2P','API','SECURITY','MOBILE_APP','COMPLIANCE')), created_at timestamptz not null default now());
create table public.aml_risk_flags (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles, transaction_id uuid references public.transactions, severity text not null check(severity in ('low','medium','high')), reason text not null, status text not null default 'open' check(status in ('open','closed')), created_at timestamptz not null default now());
create table public.reconciliation_reports (id uuid primary key default gen_random_uuid(), report_date date not null unique, status text not null check(status in ('passed','failed','review')), details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());

-- Standard timestamp maintenance and immutable ledger/audit records.
create or replace function public.set_updated_at() returns trigger language plpgsql security invoker set search_path = public as $$ begin new.updated_at = now(); return new; end; $$;
create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger wallets_set_updated_at before update on public.wallets for each row execute function public.set_updated_at();
create trigger system_config_set_updated_at before update on public.system_config for each row execute function public.set_updated_at();
create trigger kyc_submissions_set_updated_at before update on public.kyc_submissions for each row execute function public.set_updated_at();
create trigger payment_methods_set_updated_at before update on public.payment_methods for each row execute function public.set_updated_at();
create or replace function public.prevent_immutable_mutation() returns trigger language plpgsql security invoker set search_path = public as $$ begin raise exception '% records are immutable', tg_table_name; end; $$;
create trigger ledger_entries_immutable before update or delete on public.ledger_entries for each row execute function public.prevent_immutable_mutation();
create trigger audit_logs_immutable before update or delete on public.audit_logs for each row execute function public.prevent_immutable_mutation();

-- Account-level locking prevents concurrent transfers from overspending the same balance.
create or replace function public.execute_internal_transfer(p_sender uuid, p_recipient uuid, p_asset public.asset_code, p_amount numeric, p_key text) returns uuid language plpgsql security definer set search_path = public as $$
declare v_group uuid := gen_random_uuid(); v_tx uuid := gen_random_uuid(); v_existing jsonb; v_balance numeric; v_sandbox boolean; v_licensed boolean;
begin
  if p_sender = p_recipient or p_amount <= 0 then raise exception 'Invalid transfer'; end if;
  perform pg_advisory_xact_lock(hashtext(p_sender::text || ':' || p_asset::text));
  select sandbox_mode, licensing_obtained into v_sandbox, v_licensed from system_config where id = true;
  if not v_sandbox and not v_licensed then raise exception 'Live financial operations are blocked until licensing is recorded'; end if;
  select response into v_existing from idempotency_keys where user_id = p_sender and key = p_key;
  if found then return (v_existing->>'transaction_id')::uuid; end if;
  if not exists(select 1 from profiles where id = p_recipient) then raise exception 'Recipient not found'; end if;
  select coalesce(sum(le.amount), 0) into v_balance from ledger_entries le join ledger_accounts la on la.id = le.ledger_account_id where la.owner_id = p_sender and la.asset_code = p_asset;
  if v_balance < p_amount then raise exception 'Insufficient funds'; end if;
  insert into ledger_entries(transaction_group_id,ledger_account_id,asset_code,amount) select v_group,id,p_asset,-p_amount from ledger_accounts where owner_id=p_sender and asset_code=p_asset;
  insert into ledger_entries(transaction_group_id,ledger_account_id,asset_code,amount) select v_group,id,p_asset,p_amount from ledger_accounts where owner_id=p_recipient and asset_code=p_asset;
  if (select coalesce(sum(amount),0) from ledger_entries where transaction_group_id = v_group) <> 0 then raise exception 'Ledger transaction is unbalanced'; end if;
  insert into transactions(id,user_id,asset_code,amount,net_amount,type,status,reference) values (v_tx,p_sender,p_asset,p_amount,-p_amount,'transfer_out','completed','TRF-'||v_tx),(gen_random_uuid(),p_recipient,p_asset,p_amount,p_amount,'transfer_in','completed','TRF-'||v_tx||'-IN');
  insert into idempotency_keys(user_id,key,response) values(p_sender,p_key,jsonb_build_object('transaction_id',v_tx));
  insert into audit_logs(actor_id,action,entity_type,entity_id,metadata) values(p_sender,'transfer.executed','transaction',v_tx::text,jsonb_build_object('recipient_id',p_recipient,'asset',p_asset,'amount',p_amount));
  return v_tx;
end; $$;
revoke all on function public.execute_internal_transfer(uuid,uuid,public.asset_code,numeric,text) from public;

alter table public.kyc_submissions enable row level security;
alter table public.kyc_documents enable row level security;
alter table public.two_factor_credentials enable row level security;
alter table public.device_sessions enable row level security;
alter table public.deposits enable row level security;
alter table public.withdrawals enable row level security;
alter table public.rates enable row level security;
alter table public.conversions enable row level security;
alter table public.payment_methods enable row level security;
alter table public.disputes enable row level security;
alter table public.admin_roles enable row level security;
alter table public.aml_risk_flags enable row level security;
alter table public.reconciliation_reports enable row level security;

create policy "users create pending KYC submissions" on public.kyc_submissions for insert with check(auth.uid() = user_id and status = 'pending' and reviewed_by is null and reviewed_at is null and rejection_reason is null);
create policy "users read own KYC submissions" on public.kyc_submissions for select using(auth.uid() = user_id);
create policy "users read own KYC documents" on public.kyc_documents for select using(auth.uid() = user_id);
create policy "users read own deposits" on public.deposits for select using(auth.uid() = user_id);
create policy "users create pending deposits" on public.deposits for insert with check(auth.uid() = user_id and status = 'pending' and reviewed_by is null and reviewed_at is null);
create policy "users read own withdrawals" on public.withdrawals for select using(auth.uid() = user_id);
create policy "users read own conversions" on public.conversions for select using(auth.uid() = user_id);
create policy "active rates are readable" on public.rates for select using(active = true);
create policy "users manage payment methods" on public.payment_methods for all using(auth.uid() = user_id) with check(auth.uid() = user_id);
create policy "order participants read disputes" on public.disputes for select using(exists(select 1 from public.p2p_orders o where o.id = order_id and auth.uid() in (o.buyer_id,o.seller_id)));
create policy "order participants open disputes" on public.disputes for insert with check(opened_by = auth.uid() and exists(select 1 from public.p2p_orders o where o.id = order_id and auth.uid() in (o.buyer_id,o.seller_id)));

create policy "users upload own KYC files" on storage.objects for insert to authenticated with check(bucket_id = 'kyc-documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users read own KYC files" on storage.objects for select to authenticated using(bucket_id = 'kyc-documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users delete own KYC files" on storage.objects for delete to authenticated using(bucket_id = 'kyc-documents' and (storage.foldername(name))[1] = auth.uid()::text);

alter publication supabase_realtime add table public.kyc_submissions, public.disputes;
