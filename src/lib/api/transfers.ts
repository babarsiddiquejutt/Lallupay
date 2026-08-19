import { supabase } from '../supabaseClient';
import type { AssetCode } from '../../types/database';

interface TransferResponse { transactionId: string; }

/** Invokes the authenticated Edge Function; the browser never calls ledger RPCs directly. */
export async function requestInternalTransfer(input: { recipientId: string; asset: AssetCode; amount: string; idempotencyKey: string; }): Promise<TransferResponse> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.functions.invoke<TransferResponse>('transfer', { body: input });
  if (error) throw error;
  if (!data?.transactionId) throw new Error('Transfer did not return a transaction identifier.');
  return data;
}
