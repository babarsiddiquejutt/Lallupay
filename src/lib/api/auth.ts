import { supabase } from '../supabaseClient';

interface LockStatus {
  locked: boolean;
  remaining_seconds: number;
  attempts: number;
}

/** Check whether the given email is currently locked out. */
export async function checkLoginLock(email: string): Promise<LockStatus> {
  if (!supabase) return { locked: false, remaining_seconds: 0, attempts: 0 };
  const { data, error } = await supabase.rpc('check_login_lock' as never, { p_email: email } as never);
  if (error) return { locked: false, remaining_seconds: 0, attempts: 0 };
  return (data as unknown as LockStatus) ?? { locked: false, remaining_seconds: 0, attempts: 0 };
}

/** Record a failed login attempt and return the updated lock status. */
export async function recordLoginFailure(email: string): Promise<LockStatus> {
  if (!supabase) return { locked: false, remaining_seconds: 0, attempts: 0 };
  const { data, error } = await supabase.rpc('record_login_failure' as never, { p_email: email } as never);
  if (error) return { locked: false, remaining_seconds: 0, attempts: 0 };
  return (data as unknown as LockStatus) ?? { locked: false, remaining_seconds: 0, attempts: 0 };
}

/** Clear login attempts (on successful login or password reset). */
export async function clearLoginAttempts(email: string): Promise<void> {
  if (!supabase) return;
  await supabase.rpc('clear_login_attempts' as never, { p_email: email } as never);
}
