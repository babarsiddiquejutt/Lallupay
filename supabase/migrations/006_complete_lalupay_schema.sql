-- LaluPay operational schema expansion. This migration is forward-only and is safe to review before `supabase db push`.

-- Canonical asset, network and fee configuration (managed by admins through server-side code).
create table public.assets (
  code public.asset_code primary key, display_name text not null unique, decimal_places smallint not null check(decimal_places between 0 and 8),
  enabled boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
insert into public.assets(code, display_name, decimal_places) values ('PKR','Pakistani Rupee',2),('USDT','Tether USD',8) on conflict (code) do nothing;
create table public.networks (
  id uuid primary key default gen_random_uuid(), asset_code public.asset_code not null references public.assets(code), name text not null,
  network_code text not null unique, confirmations_required integer not null default 1 check(confirmations_required > 0),
  enabled boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(asset_code, name)
);
create table public.fees (
  id uuid primary key default gen_random_uuid(), operation text not null check(operation in ('deposit','withdrawal','conversion','transfer','p2p')),
  asset_code public.asset_code not null references public.assets(code), flat_amount numeric(24,8) not null default 0 check(flat_amount >= 0),
  percentage numeric(9,6) not null default 0 check(percentage between 0 and 100), active boolean not null default true,
  created_by uuid references public.profiles, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index fees_active_operation_asset_idx on public.fees(operation, asset_code) where active;

-- User-facing transfer records are immutable; their ledger movement is created only by an Edge Function.
create table public.transfers (
  id uuid primary key default gen_random_uuid(), transaction_id uuid not null unique references public.transactions on delete restrict,
  sender_id uuid not null references public.profiles on delete restrict, recipient_id uuid not null references public.profiles on delete restrict,
  asset_code public.asset_code not null references public.assets(code), amount numeric(24,8) not null check(amount > 0),
  lookup_method text not null check(lookup_method in ('email','username','mobile','qr')), idempotency_key text not null,
  created_at timestamptz not null default now(), check(sender_id <> recipient_id), unique(sender_id, idempotency_key)
);
create index transfers_sender_created_idx on public.transfers(sender_id, created_at desc);
create index transfers_recipient_created_idx on public.transfers(recipient_id, created_at desc);

-- KYC, custody and conversion support records.
create table public.deposit_addresses (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete restrict,
  network_id uuid not null references public.networks on delete restrict, address text not null, address_tag text not null default '',
  active boolean not null default true, created_at timestamptz not null default now(), unique(network_id, address, address_tag)
);
create index deposit_addresses_user_network_idx on public.deposit_addresses(user_id, network_id) where active;
alter table public.deposits add column if not exists network_id uuid references public.networks on delete restrict;
alter table public.deposits add column if not exists transaction_id uuid unique references public.transactions on delete restrict;
alter table public.deposits add column if not exists updated_at timestamptz not null default now();
alter table public.withdrawals add column if not exists network_id uuid references public.networks on delete restrict;
alter table public.withdrawals add column if not exists transaction_id uuid unique references public.transactions on delete restrict;
alter table public.withdrawals add column if not exists idempotency_key text;
alter table public.withdrawals add column if not exists updated_at timestamptz not null default now();
create unique index withdrawals_user_idempotency_idx on public.withdrawals(user_id, idempotency_key) where idempotency_key is not null;

-- P2P marketplace support.
alter table public.p2p_advertisements add column if not exists payment_window_minutes integer not null default 30 check(payment_window_minutes between 5 and 1440);
alter table public.p2p_advertisements add column if not exists updated_at timestamptz not null default now();
alter table public.p2p_orders add column if not exists escrow_transaction_group_id uuid unique;
alter table public.p2p_orders add column if not exists payment_proof_path text;
alter table public.p2p_orders add column if not exists updated_at timestamptz not null default now();
create index p2p_orders_buyer_created_idx on public.p2p_orders(buyer_id, created_at desc);
create index p2p_orders_seller_created_idx on public.p2p_orders(seller_id, created_at desc);
create index p2p_orders_status_expiry_idx on public.p2p_orders(status, expires_at) where status in ('created','payment_sent');
create table public.p2p_reputation (
  id uuid primary key default gen_random_uuid(), order_id uuid not null unique references public.p2p_orders on delete restrict,
  reviewer_id uuid not null references public.profiles on delete restrict, reviewed_user_id uuid not null references public.profiles on delete restrict,
  rating smallint not null check(rating between 1 and 5), comment text check(length(comment) <= 500), created_at timestamptz not null default now(), check(reviewer_id <> reviewed_user_id)
);
create index p2p_reputation_reviewed_idx on public.p2p_reputation(reviewed_user_id, created_at desc);

-- Role permissions and compliance/audit artifacts.
create table public.permissions (code text primary key, description text not null, created_at timestamptz not null default now());
insert into public.permissions(code, description) values
 ('admin.dashboard.read','View admin dashboard'),('kyc.review','Review KYC'),('finance.approve','Approve deposits and withdrawals'),
 ('p2p.resolve','Resolve P2P disputes'),('rates.manage','Manage rates and fees'),('compliance.review','Review AML and compliance reports'),
 ('api.manage','Manage partner API access'),('security.manage','Manage security configuration') on conflict (code) do nothing;
create table public.role_permissions (
  role text not null check(role in ('SUPER','FINANCE','KYC','SUPPORT','P2P','API','SECURITY','MOBILE_APP','COMPLIANCE')),
  permission_code text not null references public.permissions(code) on delete cascade, created_at timestamptz not null default now(), primary key(role, permission_code)
);
create table public.aml_screening_results (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete restrict,
  subject_type text not null check(subject_type in ('registration','transaction','withdrawal','deposit')), subject_id uuid,
  provider text not null default 'manual', result text not null check(result in ('clear','review','match','unavailable')),
  details jsonb not null default '{}'::jsonb, screened_at timestamptz not null default now()
);
create index aml_screening_results_user_idx on public.aml_screening_results(user_id, screened_at desc);
create table public.compliance_reports (
  id uuid primary key default gen_random_uuid(), report_type text not null check(report_type in ('sar_internal','transaction_monitoring','kyc_summary')),
  status text not null default 'draft' check(status in ('draft','submitted','closed')), report_data jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.app_releases (
  id uuid primary key default gen_random_uuid(), platform text not null check(platform in ('android','ios')), version text not null,
  build_number integer not null check(build_number > 0), storage_path text not null unique, release_notes text not null default '', mandatory boolean not null default false,
  published_at timestamptz, created_by uuid references public.profiles, created_at timestamptz not null default now(), unique(platform, version, build_number)
);

-- Partner API records deliberately store only cryptographic hashes, never raw API keys or webhook secrets.
create table public.partner_api_keys (
  id uuid primary key default gen_random_uuid(), partner_name text not null, key_prefix text not null unique,
  key_hash text not null unique, scopes text[] not null check(cardinality(scopes) > 0), webhook_url text,
  webhook_secret_hash text, revoked_at timestamptz, expires_at timestamptz, created_by uuid references public.profiles,
  created_at timestamptz not null default now()
);
create table public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(), api_key_id uuid not null references public.partner_api_keys on delete restrict,
  event_type text not null, payload jsonb not null, status text not null default 'pending' check(status in ('pending','delivered','retrying','failed','dead_letter')),
  attempt_count integer not null default 0 check(attempt_count >= 0), last_attempt_at timestamptz, response_status integer,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index webhook_deliveries_retry_idx on public.webhook_deliveries(status, created_at) where status in ('pending','retrying');

-- Uniform timestamps for mutable records.
create trigger assets_set_updated_at before update on public.assets for each row execute function public.set_updated_at();
create trigger networks_set_updated_at before update on public.networks for each row execute function public.set_updated_at();
create trigger fees_set_updated_at before update on public.fees for each row execute function public.set_updated_at();
create trigger deposits_set_updated_at before update on public.deposits for each row execute function public.set_updated_at();
create trigger withdrawals_set_updated_at before update on public.withdrawals for each row execute function public.set_updated_at();
create trigger p2p_advertisements_set_updated_at before update on public.p2p_advertisements for each row execute function public.set_updated_at();
create trigger p2p_orders_set_updated_at before update on public.p2p_orders for each row execute function public.set_updated_at();
create trigger compliance_reports_set_updated_at before update on public.compliance_reports for each row execute function public.set_updated_at();
create trigger webhook_deliveries_set_updated_at before update on public.webhook_deliveries for each row execute function public.set_updated_at();

-- Security-definer role checks are used only in RLS policies; role assignment remains service-role only.
create or replace function public.current_user_is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.admin_roles where user_id = auth.uid());
$$;
revoke all on function public.current_user_is_admin() from public;
grant execute on function public.current_user_is_admin() to authenticated;
create or replace function public.current_user_has_permission(p_permission text) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.admin_roles ar join public.role_permissions rp on rp.role = ar.role where ar.user_id = auth.uid() and (ar.role = 'SUPER' or rp.permission_code = p_permission));
$$;
revoke all on function public.current_user_has_permission(text) from public;
grant execute on function public.current_user_has_permission(text) to authenticated;

-- Every new table has RLS enabled. Tables without a policy are server/Edge-Function-only by design.
alter table public.assets enable row level security;
alter table public.networks enable row level security;
alter table public.fees enable row level security;
alter table public.transfers enable row level security;
alter table public.deposit_addresses enable row level security;
alter table public.p2p_reputation enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.aml_screening_results enable row level security;
alter table public.compliance_reports enable row level security;
alter table public.app_releases enable row level security;
alter table public.partner_api_keys enable row level security;
alter table public.webhook_deliveries enable row level security;

create policy "enabled assets readable" on public.assets for select using(enabled = true);
create policy "enabled networks readable" on public.networks for select using(enabled = true);
create policy "active fees readable" on public.fees for select using(active = true);
create policy "users read own transfers" on public.transfers for select using(auth.uid() in (sender_id, recipient_id));
create policy "users read own deposit addresses" on public.deposit_addresses for select using(auth.uid() = user_id);
create policy "reputation readable" on public.p2p_reputation for select using(true);
create policy "completed-order participants create reputation" on public.p2p_reputation for insert with check(
  reviewer_id = auth.uid() and exists(select 1 from public.p2p_orders o where o.id = order_id and o.status = 'completed' and auth.uid() in (o.buyer_id, o.seller_id) and reviewed_user_id in (o.buyer_id, o.seller_id))
);
create policy "admins read KYC queue" on public.kyc_submissions for select using(public.current_user_has_permission('kyc.review'));
create policy "admins update KYC queue" on public.kyc_submissions for update using(public.current_user_has_permission('kyc.review')) with check(public.current_user_has_permission('kyc.review'));
create policy "admins read deposits" on public.deposits for select using(public.current_user_has_permission('finance.approve'));
create policy "admins update deposits" on public.deposits for update using(public.current_user_has_permission('finance.approve')) with check(public.current_user_has_permission('finance.approve'));
create policy "admins read withdrawals" on public.withdrawals for select using(public.current_user_has_permission('finance.approve'));
create policy "admins update withdrawals" on public.withdrawals for update using(public.current_user_has_permission('finance.approve')) with check(public.current_user_has_permission('finance.approve'));
create policy "admins manage configuration" on public.assets for all using(public.current_user_has_permission('rates.manage')) with check(public.current_user_has_permission('rates.manage'));
create policy "admins manage networks" on public.networks for all using(public.current_user_has_permission('rates.manage')) with check(public.current_user_has_permission('rates.manage'));
create policy "admins manage fees" on public.fees for all using(public.current_user_has_permission('rates.manage')) with check(public.current_user_has_permission('rates.manage'));
create policy "admins manage rates" on public.rates for all using(public.current_user_has_permission('rates.manage')) with check(public.current_user_has_permission('rates.manage'));
create policy "admins read compliance reports" on public.compliance_reports for select using(public.current_user_has_permission('compliance.review'));
create policy "admins manage compliance reports" on public.compliance_reports for all using(public.current_user_has_permission('compliance.review')) with check(public.current_user_has_permission('compliance.review'));
create policy "admins read AML flags" on public.aml_risk_flags for select using(public.current_user_has_permission('compliance.review'));
create policy "admins update AML flags" on public.aml_risk_flags for update using(public.current_user_has_permission('compliance.review')) with check(public.current_user_has_permission('compliance.review'));
create policy "admins resolve disputes" on public.disputes for update using(public.current_user_has_permission('p2p.resolve')) with check(public.current_user_has_permission('p2p.resolve'));
create policy "admins manage app releases" on public.app_releases for all using(public.current_user_has_permission('security.manage')) with check(public.current_user_has_permission('security.manage'));

-- Note: public.disputes is already added to supabase_realtime by migration 004; re-adding it here would abort `db push`.
alter publication supabase_realtime add table public.deposits, public.withdrawals, public.webhook_deliveries;
