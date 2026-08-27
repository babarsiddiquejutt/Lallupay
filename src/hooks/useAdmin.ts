import { useEffect, useState } from 'react';
import { useAuth } from './useAuth';
import { supabase } from '../lib/supabaseClient';

export type AdminRole = 'SUPER' | 'FINANCE' | 'KYC' | 'SUPPORT' | 'P2P' | 'API' | 'SECURITY' | 'MOBILE_APP' | 'COMPLIANCE';

export interface AdminState {
  isAdmin: boolean;
  role: AdminRole | null;
  loading: boolean;
}

/** Detects whether the current user has an admin role in the admin_roles table. */
export function useAdmin(): AdminState {
  const { user } = useAuth();
  const [state, setState] = useState<AdminState>({ isAdmin: false, role: null, loading: true });

  useEffect(() => {
    if (!supabase || !user) { setState({ isAdmin: false, role: null, loading: false }); return; }
    let cancelled = false;
    // Use raw query to avoid typing issues with admin_roles (not in generated types).
    const fetch = async () => {
      try {
        const { data, error } = await supabase!.rpc('current_user_is_admin' as never);
        if (cancelled) return;
        if (error || !data) { setState({ isAdmin: false, role: null, loading: false }); return; }
        // Also fetch the actual role name for display.
        const { data: roleData } = await supabase!.from('admin_roles' as never).select('role').eq('user_id', user!.id).maybeSingle() as { data: { role: string } | null };
        if (cancelled) return;
        setState({ isAdmin: true, role: (roleData?.role as AdminRole) ?? null, loading: false });
      } catch {
        if (!cancelled) setState({ isAdmin: false, role: null, loading: false });
      }
    };
    void fetch();
    return () => { cancelled = true; };
  }, [user]);

  return state;
}
