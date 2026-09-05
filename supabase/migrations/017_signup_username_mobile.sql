-- 017: Add username availability check and update handle_new_user to extract
--      username and mobile from auth.users.raw_user_meta_data set during signup.

-- RPC: check whether a username is available (case-insensitive).
create or replace function public.check_username_availability(p_username text)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'available', not exists (
      select 1 from public.profiles
      where lower(username) = lower(p_username)
    ),
    'username', p_username
  );
$$;

-- Update handle_new_user to extract username and mobile from signup metadata.
-- Supabase signUp({ options: { data: { username, mobile } } }) stores
-- these in auth.users.raw_user_meta_data.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text;
  v_mobile   text;
begin
  -- Extract optional fields from signup metadata
  v_username := trim(new.raw_user_meta_data ->> 'username');
  v_mobile   := trim(new.raw_user_meta_data ->> 'mobile');

  insert into public.profiles(id, username, mobile)
  values (
    new.id,
    case when length(v_username) > 0 then v_username else null end,
    case when length(v_mobile) > 0   then v_mobile   else null end
  );

  insert into public.wallets(user_id, asset_code, balance_snapshot)
  values (new.id, 'PKR', 0), (new.id, 'USDT', 0);

  return new;
end;
$$;
