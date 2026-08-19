create or replace function public.provision_wallet_ledger_accounts() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.ledger_accounts(owner_id,asset_code,account_code) values
    (new.id,'PKR','USER_' || new.id || '_PKR'),
    (new.id,'USDT','USER_' || new.id || '_USDT');
  return new;
end; $$;
create trigger profile_ledger_accounts after insert on public.profiles for each row execute function public.provision_wallet_ledger_accounts();
create or replace function public.refresh_wallet_snapshot() returns trigger language plpgsql security definer set search_path = public as $$
begin
 update public.wallets w set balance_snapshot=(select coalesce(sum(le.amount),0) from public.ledger_entries le join public.ledger_accounts la on la.id=le.ledger_account_id where la.owner_id=w.user_id and la.asset_code=w.asset_code),updated_at=now() where w.user_id in (select owner_id from public.ledger_accounts where id=new.ledger_account_id) and w.asset_code=new.asset_code; return new;
end; $$;
create trigger ledger_entry_snapshot after insert on public.ledger_entries for each row execute function public.refresh_wallet_snapshot();
create policy "ledger account owner reads" on public.ledger_accounts for select using (auth.uid() = owner_id);
create policy "ledger entry owner reads" on public.ledger_entries for select using (exists(select 1 from public.ledger_accounts a where a.id=ledger_account_id and a.owner_id=auth.uid()));
