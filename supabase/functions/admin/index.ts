import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { requiredEnv } from '../_shared/env.ts';

type AdminRequest =
  | { action: 'updateKyc'; userId: string; status: 'approved' | 'rejected'; rejectionReason?: string }
  | { action: 'resolveDispute'; disputeId: string; outcome: 'release_to_buyer' | 'refund_to_seller'; resolution: string }
  | { action: 'adminStats' }
  | { action: 'setRate'; asset: string; buyRate: string; sellRate: string }
  | { action: 'getRate'; asset: string }
  | { action: 'setFee'; operation: string; asset: string; flatAmount: string; percentage: string }
  | { action: 'getFees' }
  | { action: 'submitDeposit'; txid: string; amount: string; address?: string }
  | { action: 'confirmDeposit'; depositId: string }
  | { action: 'rejectDeposit'; depositId: string; reason?: string }
  | { action: 'requestWithdrawal'; amount: string; address: string; idempotencyKey?: string }
  | { action: 'approveWithdrawal'; withdrawalId: string }
  | { action: 'completeWithdrawal'; withdrawalId: string; txid: string }
  | { action: 'rejectWithdrawal'; withdrawalId: string; reason?: string }
  | { action: 'getDeposits' }
  | { action: 'getWithdrawals' };

const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const isUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  const authorization = request.headers.get('Authorization');
  if (!authorization) return reply({ error: 'Unauthorized' }, 401);

  // Verify JWT and establish caller identity.
  const client = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: authorization } } });
  const { data: { user } } = await client.auth.getUser();
  if (!user) return reply({ error: 'Unauthorized' }, 401);

  let body: AdminRequest;
  try { body = await request.json() as AdminRequest; } catch { return reply({ error: 'Invalid JSON body' }, 400); }

  const admin = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'));

  // Verify the caller is an admin before any privileged operation.
  const { data: adminRole } = await admin.from('admin_roles').select('role').eq('user_id', user.id).maybeSingle();
  if (!adminRole) return reply({ error: 'Not authorised — admin role required' }, 403);

  if (body.action === 'updateKyc') {
    if (!isUuid(body.userId) || !['approved', 'rejected'].includes(body.status)) return reply({ error: 'Invalid request' }, 400);
    if (body.status === 'rejected' && (!body.rejectionReason || body.rejectionReason.trim().length < 5)) return reply({ error: 'A rejection reason of at least 5 characters is required' }, 400);
    const { error } = await admin.from('profiles').update({ kyc_status: body.status, kyc_tier: body.status === 'approved' ? 1 : 0 }).eq('id', body.userId);
    if (error) return reply({ error: error.message }, 400);
    // Log the audit trail.
    await admin.from('audit_logs').insert({ actor_id: user.id, action: 'admin.kyc.' + body.status, entity_type: 'profile', entity_id: body.userId, metadata: { status: body.status, rejection_reason: body.rejectionReason ?? null } });
    return reply({ success: true }, 200);
  }

  if (body.action === 'resolveDispute') {
    if (!isUuid(body.disputeId) || !['release_to_buyer', 'refund_to_seller'].includes(body.outcome) || typeof body.resolution !== 'string' || body.resolution.trim().length < 5) return reply({ error: 'Invalid dispute resolution' }, 400);
    // Only P2P or SUPER admins can resolve disputes.
    if (adminRole.role !== 'SUPER' && adminRole.role !== 'P2P') return reply({ error: 'Not authorised to resolve disputes' }, 403);
    const { data, error } = await admin.rpc('resolve_p2p_dispute', { p_dispute: body.disputeId, p_admin: user.id, p_outcome: body.outcome, p_resolution: body.resolution });
    if (error) return reply({ error: error.message }, 400);
    return reply({ disputeId: data }, 200);
  }

  if (body.action === 'adminStats') {
    // Aggregate stats for the admin dashboard.
    const [users, txns, orders, disputes] = await Promise.all([
      admin.from('profiles').select('*', { count: 'exact', head: true }),
      admin.from('transactions').select('*', { count: 'exact', head: true }),
      admin.from('p2p_orders').select('*', { count: 'exact', head: true }),
      admin.from('disputes').select('*', { count: 'exact', head: true }),
    ]);
    return reply({
      totalUsers: users.count ?? 0,
      totalTransactions: txns.count ?? 0,
      totalOrders: orders.count ?? 0,
      openDisputes: disputes.count ?? 0,
    }, 200);
  }

  if (body.action === 'setRate') {
    if (!['PKR', 'USDT'].includes(body.asset)) return reply({ error: 'Invalid asset' }, 400);
    const buyRate = parseFloat(body.buyRate);
    const sellRate = parseFloat(body.sellRate);
    if (isNaN(buyRate) || buyRate <= 0 || isNaN(sellRate) || sellRate <= 0) return reply({ error: 'Invalid rate values' }, 400);
    const { data, error } = await admin.rpc('admin_set_rate', { p_asset: body.asset, p_buy_rate: buyRate, p_sell_rate: sellRate, p_admin: user.id });
    return error ? reply({ error: error.message }, 400) : reply({ rateId: data }, 201);
  }

  if (body.action === 'getRate') {
    if (!['PKR', 'USDT'].includes(body.asset)) return reply({ error: 'Invalid asset' }, 400);
    const { data, error } = await admin.rpc('admin_get_current_rate', { p_asset: body.asset });
    return error ? reply({ error: error.message }, 400) : reply(data);
  }

  if (body.action === 'setFee') {
    if (!['deposit', 'withdrawal', 'conversion', 'transfer', 'p2p'].includes(body.operation)) return reply({ error: 'Invalid operation' }, 400);
    if (!['PKR', 'USDT'].includes(body.asset)) return reply({ error: 'Invalid asset' }, 400);
    const flatAmount = parseFloat(body.flatAmount);
    const percentage = parseFloat(body.percentage);
    if (isNaN(flatAmount) || flatAmount < 0 || isNaN(percentage) || percentage < 0 || percentage > 100) return reply({ error: 'Invalid fee values' }, 400);
    const { data, error } = await admin.rpc('admin_set_fee', { p_operation: body.operation, p_asset: body.asset, p_flat_amount: flatAmount, p_percentage: percentage, p_admin: user.id });
    return error ? reply({ error: error.message }, 400) : reply({ feeId: data }, 201);
  }

  if (body.action === 'getFees') {
    const { data, error } = await admin.rpc('admin_get_current_fees');
    return error ? reply({ error: error.message }, 400) : reply(data);
  }

  // ── Deposit / Withdrawal (user-facing) ──

  if (body.action === 'submitDeposit') {
    const amount = parseFloat(body.amount);
    if (isNaN(amount) || amount <= 0) return reply({ error: 'Invalid deposit amount' }, 400);
    const { data, error } = await admin.rpc('submit_deposit', { p_user: user.id, p_txid: body.txid, p_amount: amount, p_address: body.address ?? null });
    return error ? reply({ error: error.message }, 400) : reply({ depositId: data }, 201);
  }

  if (body.action === 'requestWithdrawal') {
    const amount = parseFloat(body.amount);
    if (isNaN(amount) || amount <= 0) return reply({ error: 'Invalid withdrawal amount' }, 400);
    const { data, error } = await admin.rpc('request_withdrawal', { p_user: user.id, p_amount: amount, p_address: body.address, p_idempotency_key: body.idempotencyKey ?? null });
    return error ? reply({ error: error.message }, 400) : reply({ withdrawalId: data }, 201);
  }

  // ── Admin-only: confirm/reject/approve/complete ──

  if (body.action === 'confirmDeposit') {
    const { data, error } = await admin.rpc('admin_confirm_deposit', { p_deposit: body.depositId, p_admin: user.id });
    return error ? reply({ error: error.message }, 400) : reply({ depositId: data });
  }

  if (body.action === 'rejectDeposit') {
    const { data, error } = await admin.rpc('admin_reject_deposit', { p_deposit: body.depositId, p_admin: user.id, p_reason: body.reason ?? null });
    return error ? reply({ error: error.message }, 400) : reply({ depositId: data });
  }

  if (body.action === 'approveWithdrawal') {
    const { data, error } = await admin.rpc('admin_approve_withdrawal', { p_withdrawal: body.withdrawalId, p_admin: user.id });
    return error ? reply({ error: error.message }, 400) : reply({ withdrawalId: data });
  }

  if (body.action === 'completeWithdrawal') {
    const { data, error } = await admin.rpc('admin_complete_withdrawal', { p_withdrawal: body.withdrawalId, p_admin: user.id, p_txid: body.txid });
    return error ? reply({ error: error.message }, 400) : reply({ withdrawalId: data });
  }

  if (body.action === 'rejectWithdrawal') {
    const { data, error } = await admin.rpc('admin_reject_withdrawal', { p_withdrawal: body.withdrawalId, p_admin: user.id, p_reason: body.reason ?? null });
    return error ? reply({ error: error.message }, 400) : reply({ withdrawalId: data });
  }

  if (body.action === 'getDeposits') {
    const { data, error } = await admin.from('deposits').select('*').order('created_at', { ascending: false }).limit(100);
    return error ? reply({ error: error.message }, 400) : reply(data);
  }

  if (body.action === 'getWithdrawals') {
    const { data, error } = await admin.from('withdrawals').select('*').order('created_at', { ascending: false }).limit(100);
    return error ? reply({ error: error.message }, 400) : reply(data);
  }

  return reply({ error: 'Unsupported action' }, 400);
});
