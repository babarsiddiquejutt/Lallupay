import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { requiredEnv } from '../_shared/env.ts';

interface TransferRequest { recipientId: string; asset: 'PKR' | 'USDT'; amount: string; idempotencyKey: string; }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const auth = request.headers.get('Authorization');
  if (!auth) return json({ error: 'Unauthorized' }, 401);
  const client = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await client.auth.getUser(); if (!user) return json({ error: 'Unauthorized' }, 401);
  let body: TransferRequest;
  try { body = await request.json() as TransferRequest; } catch { return json({ error: 'Invalid JSON body' }, 400); }
  if (!body.recipientId || !['PKR', 'USDT'].includes(body.asset) || !/^\d+(\.\d{1,8})?$/.test(body.amount) || body.amount === '0' || !body.idempotencyKey) return json({ error: 'Invalid request' }, 400);
  const admin = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'));
  const { data, error } = await admin.rpc('execute_internal_transfer', { p_sender: user.id, p_recipient: body.recipientId, p_asset: body.asset, p_amount: body.amount, p_key: body.idempotencyKey });
  return error ? json({ error: error.message }, 400) : json({ transactionId: data }, 201);
});
