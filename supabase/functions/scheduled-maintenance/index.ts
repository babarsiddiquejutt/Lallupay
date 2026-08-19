import { requiredEnv } from '../_shared/env.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Protected scheduler entry point. Add reconciliation and expiry jobs only as audited RPC calls. */
Deno.serve((request) => {
  const configured = requiredEnv('SCHEDULER_TOKEN');
  if (request.headers.get('Authorization') !== `Bearer ${configured}`) return json({ error: 'Unauthorized' }, 401);
  return json({ accepted: true, message: 'Scheduler endpoint authenticated. Deploy audited maintenance jobs before enabling live operations.' }, 202);
});
