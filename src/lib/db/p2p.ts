import { supabase } from '../supabaseClient';
import type { P2pAdvertisement, P2pOrder, OrderMessage, PaymentMethod, PaymentMethodType, P2pDispute } from '../../types/database';

const PROOF_BUCKET = 'p2p-payment-proofs';

// ---- Advertisements (client reads active ads; owners manage their own via RLS) ----

/** Active sell advertisements available for buyers to take. Seller identity stays pseudonymous — profiles are not joined (owner-only RLS). */
export async function getActiveSellAdvertisements(): Promise<P2pAdvertisement[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('p2p_advertisements').select('*').eq('status', 'active').eq('side', 'sell').order('price', { ascending: true });
  if (error) throw error;
  return data;
}

export async function getMyAdvertisements(userId: string): Promise<P2pAdvertisement[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('p2p_advertisements').select('*').eq('owner_id', userId).order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

/** Creates the caller's own USDT sell advertisement (RLS enforces owner_id = auth.uid()). BUY ads are intentionally unsupported in this cut. */
export async function createSellAdvertisement(input: { ownerId: string; price: string; minAmount: string; maxAmount: string; paymentMethodId: string; paymentWindowMinutes: number; }): Promise<P2pAdvertisement> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.from('p2p_advertisements').insert({
    owner_id: input.ownerId, side: 'sell', asset_code: 'PKR', price: input.price,
    min_amount: input.minAmount, max_amount: input.maxAmount, status: 'active',
    payment_method_id: input.paymentMethodId, payment_window_minutes: input.paymentWindowMinutes,
  }).select('*').single();
  if (error) throw error;
  return data;
}

export async function setAdvertisementStatus(id: string, status: 'active' | 'paused' | 'closed'): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.from('p2p_advertisements').update({ status }).eq('id', id);
  if (error) throw error;
}

// ---- Orders (read-only for clients; every write goes through the p2p Edge Function) ----

/** Orders where the caller is buyer or seller. RLS already restricts rows to participants. */
export async function getMyOrders(userId: string): Promise<P2pOrder[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('p2p_orders').select('*').or(`buyer_id.eq.${userId},seller_id.eq.${userId}`).order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function getOrder(orderId: string): Promise<P2pOrder | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('p2p_orders').select('*').eq('id', orderId).maybeSingle();
  if (error) throw error;
  return data;
}

// ---- Order messages (participant read + insert via RLS) ----

export async function getOrderMessages(orderId: string): Promise<OrderMessage[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('order_messages').select('*').eq('order_id', orderId).order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function sendOrderMessage(orderId: string, senderId: string, body: string): Promise<OrderMessage> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.from('order_messages').insert({ order_id: orderId, sender_id: senderId, body }).select('*').single();
  if (error) throw error;
  return data;
}

// ---- Disputes (participant read; opening/resolving happens server-side) ----

export async function getOrderDispute(orderId: string): Promise<P2pDispute | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('disputes').select('*').eq('order_id', orderId).maybeSingle();
  if (error) throw error;
  return data;
}

// ---- Payment methods (owner-managed via RLS) ----

export async function getMyPaymentMethods(userId: string): Promise<PaymentMethod[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('payment_methods').select('*').eq('user_id', userId).eq('active', true).order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

/**
 * Creates the caller's own payment method (RLS enforces user_id = auth.uid()).
 * `detail` is the payable identifier (e.g. wallet/account number). NOTE: it is stored in
 * `encrypted_details` as-provided; production must encrypt this at rest. Never store more than needed.
 */
export async function createPaymentMethod(input: { userId: string; methodType: PaymentMethodType; accountName: string; detail: string; }): Promise<PaymentMethod> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const trimmed = input.detail.trim();
  const masked = trimmed.length <= 4 ? trimmed : `${'*'.repeat(Math.max(0, trimmed.length - 4))}${trimmed.slice(-4)}`;
  const { data, error } = await supabase.from('payment_methods').insert({
    user_id: input.userId, method_type: input.methodType, account_name: input.accountName,
    account_reference_masked: masked, encrypted_details: trimmed, active: true,
  }).select('*').single();
  if (error) throw error;
  return data;
}

// ---- Payment-proof storage (buyer uploads under <orderId>/…, both participants read) ----

/** Uploads the buyer's PKR-payment proof and returns the storage path recorded on the order. */
export async function uploadPaymentProof(orderId: string, file: File): Promise<string> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${orderId}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage.from(PROOF_BUCKET).upload(path, file, { upsert: false });
  if (error) throw error;
  return path;
}

/** Short-lived signed URL so a participant can view an uploaded proof from the private bucket. */
export async function getPaymentProofUrl(path: string): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.storage.from(PROOF_BUCKET).createSignedUrl(path, 120);
  if (error) throw error;
  return data?.signedUrl ?? null;
}
