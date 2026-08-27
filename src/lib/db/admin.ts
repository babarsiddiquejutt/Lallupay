import { supabase } from '../supabaseClient';
import type { Profile, Transaction, P2pOrder, P2pDispute, Wallet } from '../../types/database';

/** Admin reads — all queries rely on existing RLS policies that grant admin access. */

export async function searchProfiles(query: string): Promise<Profile[]> {
  if (!supabase) return [];
  let qb = supabase.from('profiles').select('*').order('created_at', { ascending: false }).limit(50);
  if (query.trim()) {
    const q = query.trim().toLowerCase();
    qb = qb.or(`username.ilike.%${q}%,full_name.ilike.%${q}%,mobile.ilike.%${q}%`);
  }
  const { data, error } = await qb;
  if (error) throw error;
  return data;
}

export async function getProfileById(id: string): Promise<Profile | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getUserWallets(userId: string): Promise<Wallet[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('wallets').select('*').eq('user_id', userId);
  if (error) throw error;
  return data;
}

export async function getAllTransactions(page = 0, pageSize = 50): Promise<{ items: Transaction[]; total: number }> {
  if (!supabase) return { items: [], total: 0 };
  const from = page * pageSize;
  const { data, error, count } = await supabase.from('transactions').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range(from, from + pageSize - 1);
  if (error) throw error;
  return { items: data, total: count ?? 0 };
}

export async function getTransactionsForUser(userId: string, page = 0, pageSize = 50): Promise<{ items: Transaction[]; total: number }> {
  if (!supabase) return { items: [], total: 0 };
  const from = page * pageSize;
  const { data, error, count } = await supabase.from('transactions').select('*', { count: 'exact' }).eq('user_id', userId).order('created_at', { ascending: false }).range(from, from + pageSize - 1);
  if (error) throw error;
  return { items: data, total: count ?? 0 };
}

export async function getAllP2pOrders(page = 0, pageSize = 50): Promise<{ items: P2pOrder[]; total: number }> {
  if (!supabase) return { items: [], total: 0 };
  const from = page * pageSize;
  const { data, error, count } = await supabase.from('p2p_orders').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range(from, from + pageSize - 1);
  if (error) throw error;
  return { items: data, total: count ?? 0 };
}

export async function getAllDisputes(): Promise<P2pDispute[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('disputes').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function getOpenDisputes(): Promise<P2pDispute[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('disputes').select('*').eq('status', 'open').order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function getAuditLogs(page = 0, pageSize = 50): Promise<{ items: Record<string, unknown>[]; total: number }> {
  if (!supabase) return { items: [], total: 0 };
  const from = page * pageSize;
  const { data, error, count } = await supabase.from('audit_logs').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range(from, from + pageSize - 1);
  if (error) throw error;
  return { items: data as Record<string, unknown>[], total: count ?? 0 };
}

export async function getKycSubmissions(): Promise<Record<string, unknown>[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('kyc_submissions').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data as Record<string, unknown>[];
}

export async function getSystemConfig(): Promise<Record<string, unknown> | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('system_config').select('*').eq('id', true).maybeSingle();
  if (error) throw error;
  return data as Record<string, unknown> | null;
}

export async function getAllProfiles(page = 0, pageSize = 50): Promise<{ items: Profile[]; total: number }> {
  if (!supabase) return { items: [], total: 0 };
  const from = page * pageSize;
  const { data, error, count } = await supabase.from('profiles').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range(from, from + pageSize - 1);
  if (error) throw error;
  return { items: data, total: count ?? 0 };
}
