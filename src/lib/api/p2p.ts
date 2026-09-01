import { supabase } from '../supabaseClient';
import type { PaymentMethodType } from '../../types/database';

interface OrderResponse { orderId: string; }
interface DisputeResponse { disputeId: string; }
export interface OrderPaymentDetails { methodType: PaymentMethodType; accountName: string; accountReferenceMasked: string; payableDetail: string; }
export interface SellerStats { completed_30d: number; total_30d: number; completion_rate: number; avg_rating: number; total_reviews: number; }

/** Surfaces the Edge Function's own error message (e.g. "Insufficient USDT balance") instead of the SDK's generic status text. */
async function readFunctionError(error: unknown): Promise<string> {
  const context = (error as { context?: unknown } | null)?.context;
  if (context instanceof Response) {
    try { const parsed = await context.clone().json(); if (parsed && typeof parsed.error === 'string') return parsed.error; } catch { /* fall through to generic */ }
  }
  return error instanceof Error ? error.message : 'The P2P service is unavailable.';
}

async function invokeP2p<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.functions.invoke<T>('p2p', { body });
  if (error) throw new Error(await readFunctionError(error));
  if (!data) throw new Error('The P2P service returned no data.');
  return data;
}

/** Opens a USDT sell order against an active advertisement. The seller's USDT is escrowed server-side; the browser never calls ledger RPCs directly. */
export function createSellOrder(input: { advertisementId: string; amount: string; idempotencyKey: string; }): Promise<OrderResponse> {
  return invokeP2p<OrderResponse>({ action: 'createSellOrder', ...input });
}

/** Buyer marks that PKR has been paid to the seller off-platform, optionally attaching a proof-of-payment storage path. Moves no funds. */
export function markPaymentSent(input: { orderId: string; proofPath?: string; }): Promise<OrderResponse> {
  return invokeP2p<OrderResponse>({ action: 'markPaymentSent', ...input });
}

/** Seller confirms PKR receipt; releases the escrowed USDT to the buyer. */
export function releaseOrder(orderId: string): Promise<OrderResponse> {
  return invokeP2p<OrderResponse>({ action: 'release', orderId });
}

/** Either participant cancels an order that is still awaiting payment; escrow is refunded to the seller. */
export function cancelOrder(orderId: string): Promise<OrderResponse> {
  return invokeP2p<OrderResponse>({ action: 'cancel', orderId });
}

/** Either participant escalates a paid order to a dispute, freezing the escrow until staff resolve it. */
export function openDispute(input: { orderId: string; reason: string; }): Promise<DisputeResponse> {
  return invokeP2p<DisputeResponse>({ action: 'openDispute', ...input });
}

/** Fetches the seller's payable account details for an order. The server returns these only to the two order participants. */
export function getOrderPaymentDetails(orderId: string): Promise<OrderPaymentDetails> {
  return invokeP2p<OrderPaymentDetails>({ action: 'paymentDetails', orderId });
}

/** Submit a review after a completed P2P order. */
export function submitReview(input: { orderId: string; reviewedUser: string; rating: number; comment?: string }): Promise<{ reviewId: string }> {
  return invokeP2p<{ reviewId: string }>({ action: 'submitReview', ...input });
}

/** Get seller stats (30-day completion, avg rating, review count). */
export function getSellerStats(sellerId: string): Promise<SellerStats> {
  return invokeP2p<SellerStats>({ action: 'sellerStats', sellerId });
}

/** Send a heartbeat to keep the seller's advertisement online. */
export function sendHeartbeat(): Promise<{ ok: boolean }> {
  return invokeP2p<{ ok: boolean }>({ action: 'heartbeat' });
}
