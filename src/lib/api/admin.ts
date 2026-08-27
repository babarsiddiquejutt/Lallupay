import { supabase } from '../supabaseClient';

interface AdminResponse { success?: boolean; disputeId?: string; }

async function readFunctionError(error: unknown): Promise<string> {
  const context = (error as { context?: unknown } | null)?.context;
  if (context instanceof Response) {
    try { const parsed = await context.clone().json(); if (parsed && typeof parsed.error === 'string') return parsed.error; } catch { /* fall through */ }
  }
  return error instanceof Error ? error.message : 'The admin service is unavailable.';
}

async function invokeAdmin<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.functions.invoke<T>('admin', { body });
  if (error) throw new Error(await readFunctionError(error));
  if (!data) throw new Error('The admin service returned no data.');
  return data;
}

export function adminUpdateKyc(userId: string, status: 'approved' | 'rejected', rejectionReason?: string): Promise<AdminResponse> {
  return invokeAdmin<AdminResponse>({ action: 'updateKyc', userId, status, rejectionReason });
}

export function adminResolveDispute(disputeId: string, outcome: 'release_to_buyer' | 'refund_to_seller', resolution: string): Promise<AdminResponse> {
  return invokeAdmin<AdminResponse>({ action: 'resolveDispute', disputeId, outcome, resolution });
}

export interface AdminStats { totalUsers: number; totalTransactions: number; totalOrders: number; openDisputes: number; }
export function adminGetStats(): Promise<AdminStats> {
  return invokeAdmin<AdminStats>({ action: 'adminStats' });
}
