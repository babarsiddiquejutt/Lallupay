import { supabase } from '../supabaseClient';
import type { Wallet } from '../../types/database';

export async function getWallets(userId: string): Promise<Wallet[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('wallets').select('*').eq('user_id', userId).order('asset_code');
  if (error) throw error;
  return data;
}
