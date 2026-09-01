import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { requiredEnv } from '../_shared/env.ts';

// Server-authoritative P2P (USDT sell) endpoint. The caller's identity always comes from the
// verified JWT, never the request body. Every money movement happens inside a service-role RPC
// that locks balances, snapshots the price, and writes balanced double-entry ledger records.
type P2pRequest =
  | { action: 'createSellOrder'; advertisementId: string; amount: string; idempotencyKey: string }
  | { action: 'markPaymentSent'; orderId: string; proofPath?: string }
  | { action: 'release'; orderId: string }
  | { action: 'cancel'; orderId: string }
  | { action: 'openDispute'; orderId: string; reason: string }
  | { action: 'resolveDispute'; disputeId: string; outcome: 'release_to_buyer' | 'refund_to_seller'; resolution: string }
  | { action: 'paymentDetails'; orderId: string }
  | { action: 'submitReview'; orderId: string; reviewedUser: string; rating: number; comment?: string }
  | { action: 'sellerStats'; sellerId: string }
  | { action: 'heartbeat' };

const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const isUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
// PKR is the fiat leg (2 dp). Amounts are never trusted for balance decisions, but rejecting malformed precision early keeps the ledger clean.
const pkrAmount = /^\d+(\.\d{1,2})?$/;

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  const authorization = request.headers.get('Authorization'); if (!authorization) return reply({ error: 'Unauthorized' }, 401);

  const client = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: authorization } } });
  const { data: { user } } = await client.auth.getUser(); if (!user) return reply({ error: 'Unauthorized' }, 401);

  let body: P2pRequest; try { body = await request.json() as P2pRequest; } catch { return reply({ error: 'Invalid JSON body' }, 400); }
  const admin = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'));

  if (body.action === 'createSellOrder') {
    if (!isUuid(body.advertisementId) || !pkrAmount.test(body.amount ?? '') || body.amount === '0' || typeof body.idempotencyKey !== 'string' || body.idempotencyKey.length < 16) return reply({ error: 'Invalid order request' }, 400);
    const { data, error } = await admin.rpc('create_p2p_sell_order', { p_ad: body.advertisementId, p_buyer: user.id, p_amount: body.amount, p_key: body.idempotencyKey });
    return error ? reply({ error: error.message }, 400) : reply({ orderId: data }, 201);
  }

  if (body.action === 'markPaymentSent') {
    if (!isUuid(body.orderId) || (body.proofPath !== undefined && typeof body.proofPath !== 'string')) return reply({ error: 'Invalid request' }, 400);
    const { data, error } = await admin.rpc('mark_p2p_payment_sent', { p_order: body.orderId, p_actor: user.id, p_proof_path: body.proofPath ?? null });
    return error ? reply({ error: error.message }, 400) : reply({ orderId: data });
  }

  if (body.action === 'release') {
    if (!isUuid(body.orderId)) return reply({ error: 'Invalid request' }, 400);
    const { data, error } = await admin.rpc('release_p2p_order', { p_order: body.orderId, p_actor: user.id });
    return error ? reply({ error: error.message }, 400) : reply({ orderId: data });
  }

  if (body.action === 'cancel') {
    if (!isUuid(body.orderId)) return reply({ error: 'Invalid request' }, 400);
    const { data, error } = await admin.rpc('cancel_p2p_order', { p_order: body.orderId, p_actor: user.id });
    return error ? reply({ error: error.message }, 400) : reply({ orderId: data });
  }

  if (body.action === 'openDispute') {
    if (!isUuid(body.orderId) || typeof body.reason !== 'string' || body.reason.trim().length < 5) return reply({ error: 'A dispute reason of at least 5 characters is required' }, 400);
    const { data, error } = await admin.rpc('open_p2p_dispute', { p_order: body.orderId, p_actor: user.id, p_reason: body.reason });
    return error ? reply({ error: error.message }, 400) : reply({ disputeId: data }, 201);
  }

  if (body.action === 'resolveDispute') {
    // Authorisation (p2p.resolve permission) is enforced inside the RPC against this admin id.
    if (!isUuid(body.disputeId) || !['release_to_buyer', 'refund_to_seller'].includes(body.outcome) || typeof body.resolution !== 'string' || body.resolution.trim().length < 5) return reply({ error: 'Invalid dispute resolution' }, 400);
    const { data, error } = await admin.rpc('resolve_p2p_dispute', { p_dispute: body.disputeId, p_admin: user.id, p_outcome: body.outcome, p_resolution: body.resolution });
    return error ? reply({ error: error.message }, 400) : reply({ disputeId: data });
  }

  if (body.action === 'paymentDetails') {
    if (!isUuid(body.orderId)) return reply({ error: 'Invalid request' }, 400);
    const { data, error } = await admin.rpc('get_p2p_order_payment_details', { p_order: body.orderId, p_actor: user.id });
    if (error) return reply({ error: error.message }, 400);
    const match = Array.isArray(data) ? data[0] : data;
    if (!match) return reply({ error: 'No payment details are available for this order.' }, 404);
    return reply({ methodType: match.method_type, accountName: match.account_name, accountReferenceMasked: match.account_reference_masked, payableDetail: match.payable_detail });
  }

  if (body.action === 'submitReview') {
    if (!isUuid(body.orderId) || !isUuid(body.reviewedUser) || typeof body.rating !== 'number' || body.rating < 1 || body.rating > 5) return reply({ error: 'Invalid review request' }, 400);
    if (body.comment !== undefined && typeof body.comment !== 'string') return reply({ error: 'Invalid review comment' }, 400);
    const { data, error } = await admin.rpc('submit_p2p_review', { p_order: body.orderId, p_reviewer: user.id, p_reviewed_user: body.reviewedUser, p_rating: body.rating, p_comment: body.comment ?? null });
    return error ? reply({ error: error.message }, 400) : reply({ reviewId: data }, 201);
  }

  if (body.action === 'sellerStats') {
    if (!isUuid(body.sellerId)) return reply({ error: 'Invalid request' }, 400);
    const { data, error } = await admin.rpc('get_seller_stats', { p_seller: body.sellerId });
    return error ? reply({ error: error.message }, 400) : reply(data);
  }

  if (body.action === 'heartbeat') {
    await admin.rpc('update_seller_heartbeat', { p_user: user.id });
    return reply({ ok: true });
  }

  return reply({ error: 'Unsupported action' }, 400);
});
