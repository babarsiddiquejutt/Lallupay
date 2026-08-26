# transfer

Authenticated, idempotent internal (user-to-user) transfer endpoint. Set `SUPABASE_SERVICE_ROLE_KEY` using `supabase secrets set`; it must never appear in frontend code or GitHub logs.

The caller's identity is taken from their verified JWT, never from the request body. Two actions:

- `{ "action": "resolve", "method": "username" | "email" | "mobile", "value": "..." }` — resolves an exact recipient identifier to `{ recipientId, username, fullName, isSelf }` via the service-role-only `lookup_transfer_recipient` function (profiles RLS stays owner-only for the browser). Returns `404` when no account matches.
- `{ "action": "execute", "recipientId", "asset", "amount", "idempotencyKey", "lookupMethod" }` — calls the atomic `execute_internal_transfer` RPC. Balance, self-transfer, recipient existence, idempotency-key reuse, and the balanced double-entry ledger write are all enforced server-side.

CORS preflight (`OPTIONS`) is handled so the browser SDK can invoke the function directly.
