-- Role-aware administrator read access. Mutating ledger records remains Edge-Function/service-role-only.
create or replace function public.current_user_has_role(p_role text) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.admin_roles where user_id = auth.uid() and role = p_role);
$$;
revoke all on function public.current_user_has_role(text) from public;
grant execute on function public.current_user_has_role(text) to authenticated;

drop policy if exists "notification owner manages" on public.notifications;
create policy "users read own notifications" on public.notifications for select using(auth.uid() = user_id);
create policy "users mark own notifications" on public.notifications for update using(auth.uid() = user_id) with check(auth.uid() = user_id);
create policy "users delete own notifications" on public.notifications for delete using(auth.uid() = user_id);

create policy "finance admins read wallets" on public.wallets for select using(public.current_user_has_permission('finance.approve'));
create policy "finance admins read transactions" on public.transactions for select using(public.current_user_has_permission('finance.approve'));
create policy "finance admins read ledger accounts" on public.ledger_accounts for select using(public.current_user_has_permission('finance.approve'));
create policy "finance admins read ledger entries" on public.ledger_entries for select using(public.current_user_has_permission('finance.approve'));
create policy "security admins read audit logs" on public.audit_logs for select using(public.current_user_has_permission('security.manage'));
create policy "finance admins read reconciliation reports" on public.reconciliation_reports for select using(public.current_user_has_permission('finance.approve'));
create policy "finance admins read conversions" on public.conversions for select using(public.current_user_has_permission('finance.approve'));
create policy "security admins read device sessions" on public.device_sessions for select using(public.current_user_has_permission('security.manage'));
create policy "super admins read system configuration" on public.system_config for select using(public.current_user_has_role('SUPER'));
create policy "super admins update system configuration" on public.system_config for update using(public.current_user_has_role('SUPER')) with check(public.current_user_has_role('SUPER'));
create policy "admins read own role" on public.admin_roles for select using(user_id = auth.uid());
create policy "admins read permissions" on public.permissions for select using(public.current_user_is_admin());
create policy "admins read role permissions" on public.role_permissions for select using(public.current_user_is_admin());

-- Prevent authenticated browser clients from changing fields that are approved by staff or written by the server.
revoke update (status, reviewed_by, reviewed_at, rejection_reason) on public.kyc_submissions from authenticated;
revoke update (status, reviewed_by, reviewed_at, transaction_id, updated_at) on public.deposits from authenticated;
revoke update (status, reviewed_by, reviewed_at, transaction_id, updated_at) on public.withdrawals from authenticated;
revoke update (status, resolution, resolved_by, resolved_at) on public.disputes from authenticated;
