import { supabase } from '../supabaseClient';
import type { AssetCode } from '../../types/database';

export type LookupMethod = 'username' | 'email' | 'mobile';
export interface ResolvedRecipient { recipientId: string; username: string | null; fullName: string | null; isSelf: boolean; }
interface TransferResponse { transactionId: string; }

/** Surfaces the Edge Function's own error message (e.g. "Insufficient funds") instead of the SDK's generic status text. */
async function readFunctionError(error: unknown): Promise<string> {
  const context = (error as { context?: unknown } | null)?.context;
  if (context instanceof Response) {
    try { const parsed = await context.clone().json(); if (parsed && typeof parsed.error === 'string') return parsed.error; } catch { /* fall through to generic */ }
  }
  return error instanceof Error ? error.message : 'The transfer service is unavailable.';
}

async function invokeTransfer<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.functions.invoke<T>('transfer', { body });
  if (error) throw new Error(await readFunctionError(error));
  if (!data) throw new Error('The transfer service returned no data.');
  return data;
}

/** Resolves a recipient identifier server-side; the browser cannot read other users' profiles directly. */
export function resolveRecipient(method: LookupMethod, value: string): Promise<ResolvedRecipient> {
  return invokeTransfer<ResolvedRecipient>({ action: 'resolve', method, value });
}

/** Executes an idempotent, server-authoritative internal transfer. The browser never calls ledger RPCs directly. */
export function requestInternalTransfer(input: { recipientId: string; asset: AssetCode; amount: string; idempotencyKey: string; lookupMethod: LookupMethod; }): Promise<TransferResponse> {
  return invokeTransfer<TransferResponse>({ action: 'execute', ...input });
}
