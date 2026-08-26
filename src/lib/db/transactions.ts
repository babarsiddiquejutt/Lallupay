import { supabase } from '../supabaseClient';
import type { Transaction } from '../../types/database';

export interface TransactionPage { items: Transaction[]; total: number; }

export async function getTransactions(userId: string, page = 0, pageSize = 20): Promise<Transaction[]> {
  return (await getTransactionsPage(userId, page, pageSize)).items;
}

/** Fetches a bounded transaction page under the caller's RLS scope. */
export async function getTransactionsPage(userId: string, page = 0, pageSize = 20): Promise<TransactionPage> {
  if (!supabase) return { items: [], total: 0 };
  const from = page * pageSize;
  const { data, error, count } = await supabase.from('transactions').select('*', { count: 'exact' }).eq('user_id', userId).order('created_at', { ascending: false }).range(from, from + pageSize - 1);
  if (error) throw error;
  return { items: data, total: count ?? 0 };
}
