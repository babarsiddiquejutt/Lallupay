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

export interface AdminRate { id: string; asset_code: string; buy_rate: number; sell_rate: number; version: number; created_at: string; }
export function adminSetRate(asset: string, buyRate: string, sellRate: string): Promise<{ rateId: string }> {
  return invokeAdmin<{ rateId: string }>({ action: 'setRate', asset, buyRate, sellRate });
}
export function adminGetRate(asset: string): Promise<AdminRate | null> {
  return invokeAdmin<AdminRate | null>({ action: 'getRate', asset });
}

export interface AdminFee { id: string; operation: string; asset_code: string; flat_amount: number; percentage: number; created_at: string; }
export function adminSetFee(operation: string, asset: string, flatAmount: string, percentage: string): Promise<{ feeId: string }> {
  return invokeAdmin<{ feeId: string }>({ action: 'setFee', operation, asset, flatAmount, percentage });
}
export function adminGetFees(): Promise<AdminFee[]> {
  return invokeAdmin<AdminFee[]>({ action: 'getFees' });
}
