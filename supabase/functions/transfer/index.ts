import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { requiredEnv } from '../_shared/env.ts';

type LookupMethod = 'email' | 'username' | 'mobile' | 'qr';
interface ResolveRequest { action: 'resolve'; method: LookupMethod; value: string; }
interface ExecuteRequest { action: 'execute'; recipientId: string; asset: 'PKR' | 'USDT'; amount: string; idempotencyKey: string; lookupMethod: LookupMethod; }
type TransferRequest = ResolveRequest | ExecuteRequest;

const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const methods: LookupMethod[] = ['email', 'username', 'mobile', 'qr'];
// Each asset's own precision (PKR: 2 dp, USDT: 8 dp). Amounts are never trusted from the client for balance decisions,
// but rejecting malformed precision early keeps the ledger consistent with the asset definition.
const amountPattern: Record<string, RegExp> = { PKR: /^\d+(\.\d{1,2})?$/, USDT: /^\d+(\.\d{1,8})?$/ };

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  const authorization = request.headers.get('Authorization'); if (!authorization) return reply({ error: 'Unauthorized' }, 401);

  // The caller's identity is established from their JWT, never from the request body.
  const client = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: authorization } } });
  const { data: { user } } = await client.auth.getUser(); if (!user) return reply({ error: 'Unauthorized' }, 401);

  let body: TransferRequest; try { body = await request.json() as TransferRequest; } catch { return reply({ error: 'Invalid JSON body' }, 400); }
  const admin = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'));

  if (body.action === 'resolve') {
    if (!methods.includes(body.method) || typeof body.value !== 'string' || body.value.trim().length === 0) return reply({ error: 'Invalid recipient lookup' }, 400);
    const { data, error } = await admin.rpc('lookup_transfer_recipient', { p_method: body.method, p_value: body.value });
    if (error) return reply({ error: error.message }, 400);
    const match = Array.isArray(data) ? data[0] : data;
    if (!match) return reply({ error: 'No LaluPay account matches that recipient.' }, 404);
    return reply({ recipientId: match.id, username: match.username, fullName: match.full_name, isSelf: match.id === user.id });
  }

  if (body.action === 'execute') {
    const pattern = amountPattern[body.asset];
    if (!body.recipientId || !pattern || !pattern.test(body.amount ?? '') || Number(body.amount) === 0 || !body.idempotencyKey || body.idempotencyKey.length < 16 || !methods.includes(body.lookupMethod)) return reply({ error: 'Invalid transfer request' }, 400);
    if (body.recipientId === user.id) return reply({ error: 'You cannot transfer to yourself.' }, 400);
    const { data, error } = await admin.rpc('execute_internal_transfer', { p_sender: user.id, p_recipient: body.recipientId, p_asset: body.asset, p_amount: body.amount, p_key: body.idempotencyKey, p_lookup_method: body.lookupMethod });
    return error ? reply({ error: error.message }, 400) : reply({ transactionId: data }, 201);
  }

  return reply({ error: 'Unsupported action' }, 400);
});
