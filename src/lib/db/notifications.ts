import { supabase } from '../supabaseClient';
import type { Notification } from '../../types/database';

export async function getNotifications(userId: string): Promise<Notification[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', notificationId);
  if (error) throw error;
}
