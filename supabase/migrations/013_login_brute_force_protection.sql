-- Login brute-force protection.
-- 3 consecutive failed attempts → account locked for 8 hours.
-- Forgot-password remains available during lock.
-- Successful password reset clears the lock.

create table public.login_attempts (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  attempted_at timestamptz not null default now(),
  success boolean not null default false,
  ip_address inet
);

create index login_attempts_email_idx on public.login_attempts(email, attempted_at desc);

-- Check whether a login is currently locked. Returns: { locked: boolean, remaining_seconds: integer, attempts: integer }
create or replace function public.check_login_lock(p_email text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_max_attempts constant integer := 3;
  v_lock_duration constant interval := '8 hours';
  v_email text := lower(trim(p_email));
  v_recent_failures integer;
  v_lock_until timestamptz;
begin
  -- Count consecutive recent failures (within the lock window).
  select count(*) into v_recent_failures
  from public.login_attempts
  where email = v_email
    and success = false
    and attempted_at > now() - v_lock_duration;

  if v_recent_failures >= v_max_attempts then
    -- Find when the lock expires (last failure + 8 hours).
    select attempted_at + v_lock_duration into v_lock_until
    from public.login_attempts
    where email = v_email and success = false
    order by attempted_at desc
    limit 1;

    if v_lock_until > now() then
      return jsonb_build_object(
        'locked', true,
        'remaining_seconds', extract(epoch from (v_lock_until - now()))::integer,
        'attempts', v_recent_failures
      );
    end if;
  end if;

  return jsonb_build_object(
    'locked', false,
    'remaining_seconds', 0,
    'attempts', v_recent_failures
  );
end; $$;

revoke all on function public.check_login_lock(text) from public, authenticated, anon;
grant execute on function public.check_login_lock(text) to anon, authenticated, service_role;

-- Record a failed login attempt.
create or replace function public.record_login_failure(p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(trim(p_email));
begin
  insert into public.login_attempts(email, success) values (v_email, false);
  -- Return updated lock status.
  return public.check_login_lock(v_email);
end; $$;

revoke all on function public.record_login_failure(text) from public, authenticated, anon;
grant execute on function public.record_login_failure(text) to anon, authenticated, service_role;

-- Clear login attempts on successful login or password reset.
create or replace function public.clear_login_attempts(p_email text)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.login_attempts where email = lower(trim(p_email));
end; $$;

revoke all on function public.clear_login_attempts(text) from public, authenticated, anon;
grant execute on function public.clear_login_attempts(text) to anon, authenticated, service_role;

-- RLS: login_attempts is server-only (no client access needed).
alter table public.login_attempts enable row level security;
-- No policies = no client access (Edge Functions use service role).

-- Audit the brute-force protection events.
