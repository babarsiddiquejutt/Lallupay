import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { requiredEnv } from '../_shared/env.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * Scheduled maintenance endpoint.
 * Called by GitHub Actions cron (`scheduled-jobs.yml`) with a Bearer token.
 * Runs audited server-side jobs in order. Each job is idempotent and safe to re-run.
 */
Deno.serve(async (request) => {
  const token = requiredEnv('SCHEDULER_TOKEN');
  if (request.headers.get('Authorization') !== `Bearer ${token}`) return json({ error: 'Unauthorized' }, 401);

  const admin = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'));
  const results: Record<string, unknown> = {};

  // 1. Expire unpaid P2P orders past their payment window.
  //    Calls the server-side function that atomically refunds escrowed USDT to each seller.
  try {
    const { data, error } = await admin.rpc('expire_p2p_orders');
    results.p2pOrderExpiry = error ? { error: error.message } : { expired: data ?? 0 };
  } catch (reason) {
    results.p2pOrderExpiry = { error: reason instanceof Error ? reason.message : 'Unknown error' };
  }

  return json({ accepted: true, ran_at: new Date().toISOString(), results }, 202);
});
