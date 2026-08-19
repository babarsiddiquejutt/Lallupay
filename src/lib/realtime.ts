import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';
import type { Database } from '../types/database';

type TableName = keyof Database['public']['Tables'];
type ChangeHandler = (payload: unknown) => void;

/** Subscribes to a table and returns a cleanup callback safe for React effects. */
export function subscribeToTable(table: TableName, filter: string | undefined, onChange: ChangeHandler): () => void {
  if (!supabase) return () => undefined;
  const client = supabase;
  const channel: RealtimeChannel = client.channel(`live:${String(table)}:${filter ?? 'all'}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: String(table), filter }, onChange)
    .subscribe();
  return () => { void client.removeChannel(channel); };
}
