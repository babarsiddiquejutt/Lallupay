import { supabase } from '../supabaseClient';
import type { Transaction } from '../../types/database';

export async function getTransactions(userId: string, page = 0, pageSize = 20): Promise<Transaction[]> {
  if (!supabase) return [];
  const from = page * pageSize;
  const { data, error } = await supabase.from('transactions').select('*').eq('user_id', userId).order('created_at', { ascending: false }).range(from, from + pageSize - 1);
  if (error) throw error;
  return data;
}
