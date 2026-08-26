import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { requiredEnv } from '../_shared/env.ts';

interface ConversionRequest { action: 'quote' | 'execute'; fromAsset: 'PKR' | 'USDT'; toAsset: 'PKR' | 'USDT'; amount: string; idempotencyKey?: string; }
const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  const authorization = request.headers.get('Authorization'); if (!authorization) return reply({ error: 'Unauthorized' }, 401);
  const client = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: authorization } } });
  const { data: { user } } = await client.auth.getUser(); if (!user) return reply({ error: 'Unauthorized' }, 401);
  let body: ConversionRequest; try { body = await request.json() as ConversionRequest; } catch { return reply({ error: 'Invalid JSON body' }, 400); }
  if (!['quote','execute'].includes(body.action) || body.fromAsset === body.toAsset || !['PKR','USDT'].includes(body.fromAsset) || !['PKR','USDT'].includes(body.toAsset) || !/^\d+(\.\d{1,8})?$/.test(body.amount) || body.amount === '0') return reply({ error: 'Invalid conversion request' }, 400);
  const admin = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'));
  if (body.action === 'quote') { const { data, error } = await admin.rpc('quote_conversion', { p_from: body.fromAsset, p_to: body.toAsset, p_amount: body.amount }); return error ? reply({ error: error.message }, 400) : reply(data); }
  if (!body.idempotencyKey) return reply({ error: 'Idempotency key is required' }, 400);
  const { data, error } = await admin.rpc('execute_conversion', { p_user: user.id, p_from: body.fromAsset, p_to: body.toAsset, p_amount: body.amount, p_key: body.idempotencyKey });
  return error ? reply({ error: error.message }, 400) : reply({ conversionId: data }, 201);
});
