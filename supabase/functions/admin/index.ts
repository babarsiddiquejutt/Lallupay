import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { requiredEnv } from '../_shared/env.ts';

type AdminRequest =
  | { action: 'updateKyc'; userId: string; status: 'approved' | 'rejected'; rejectionReason?: string }
  | { action: 'resolveDispute'; disputeId: string; outcome: 'release_to_buyer' | 'refund_to_seller'; resolution: string }
  | { action: 'adminStats' };

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

  return reply({ error: 'Unsupported action' }, 400);
});
