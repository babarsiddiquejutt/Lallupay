import { supabase } from '../supabaseClient';

interface AdminResponse<T = unknown> {
  data: T | null;
  error?: string;
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.functions.invoke<T>('admin', { body });
  if (error) {
    const context = (error as { context?: unknown } | null)?.context;
    if (context instanceof Response) {
      try { const parsed = await context.clone().json(); if (parsed && typeof parsed.error === 'string') throw new Error(parsed.error); } catch (e) { if (e instanceof Error && e.message !== 'Unexpected token') throw e; }
    }
    throw new Error(error.message || 'Service unavailable.');
  }
  if (!data) throw new Error('Service returned no data.');
  return data;
}

/** User submits a USDT TRC20 deposit for admin review. */
export async function submitDeposit(input: { txid: string; amount: string; address?: string }): Promise<{ depositId: string }> {
  return invoke<{ depositId: string }>({ action: 'submitDeposit', txid: input.txid, amount: input.amount, address: input.address });
}

/** User requests a USDT TRC20 withdrawal. */
export async function requestWithdrawal(input: { amount: string; address: string; idempotencyKey?: string }): Promise<{ withdrawalId: string }> {
  return invoke<{ withdrawalId: string }>({ action: 'requestWithdrawal', amount: input.amount, address: input.address, idempotencyKey: input.idempotencyKey });
}

/** Admin confirms a deposit. */
export async function confirmDeposit(depositId: string): Promise<AdminResponse> {
  return invoke<AdminResponse>({ action: 'confirmDeposit', depositId });
}

/** Admin rejects a deposit. */
export async function rejectDeposit(depositId: string, reason?: string): Promise<AdminResponse> {
  return invoke<AdminResponse>({ action: 'rejectDeposit', depositId, reason });
}

/** Admin approves a withdrawal. */
export async function approveWithdrawal(withdrawalId: string): Promise<AdminResponse> {
  return invoke<AdminResponse>({ action: 'approveWithdrawal', withdrawalId });
}

/** Admin completes a withdrawal with blockchain TXID. */
export async function completeWithdrawal(withdrawalId: string, txid: string): Promise<AdminResponse> {
  return invoke<AdminResponse>({ action: 'completeWithdrawal', withdrawalId, txid });
}

/** Admin rejects a withdrawal. */
export async function rejectWithdrawal(withdrawalId: string, reason?: string): Promise<AdminResponse> {
  return invoke<AdminResponse>({ action: 'rejectWithdrawal', withdrawalId, reason });
}

/** Admin gets all deposits. */
export async function getDeposits(): Promise<Record<string, unknown>[]> {
  return invoke<Record<string, unknown>[]>({ action: 'getDeposits' });
}

/** Admin gets all withdrawals. */
export async function getWithdrawals(): Promise<Record<string, unknown>[]> {
  return invoke<Record<string, unknown>[]>({ action: 'getWithdrawals' });
}
