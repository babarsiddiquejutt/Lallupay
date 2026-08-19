import { supabase } from '../supabaseClient';
import type { P2pAdvertisement } from '../../types/database';

export async function getActiveAdvertisements(): Promise<P2pAdvertisement[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('p2p_advertisements').select('*').eq('status', 'active').order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}
