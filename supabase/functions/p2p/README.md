# p2p

Authenticated, server-authoritative P2P endpoint for the **USDT sell** flow. Set `SUPABASE_SERVICE_ROLE_KEY` with `supabase secrets set`; it must never appear in frontend code or logs.

The caller's identity comes from the verified JWT, never the request body. Only USDT is escrowed by the platform — **PKR is paid directly from buyer to seller off-platform** and is never held or escrowed here.

Actions:

- `{ "action": "createSellOrder", "advertisementId", "amount", "idempotencyKey" }` — opens an order against an active `sell` ad. `create_p2p_sell_order` snapshots the ad price, computes the USDT quantity (`trunc(amount / price, 8)`), checks and locks the seller's USDT into the `SYSTEM_P2P_ESCROW_USDT` account under an advisory lock, and records the order (`status = created`). Idempotent on `(buyer, key)`.
- `{ "action": "markPaymentSent", "orderId", "proofPath?" }` — buyer-only, `created → payment_sent`. Records the payment-proof storage path. **Moves no funds.**
- `{ "action": "release", "orderId" }` — seller-only, `payment_sent → completed`. Releases escrowed USDT to the buyer (minus an active `p2p`/USDT fee, if one is configured — none is by default).
- `{ "action": "cancel", "orderId" }` — either participant, `created → cancelled`. Refunds escrow to the seller. Not allowed after `payment_sent` (use a dispute).
- `{ "action": "openDispute", "orderId", "reason" }` — either participant, only from `payment_sent`. Opens a dispute and freezes the order (`disputed`).
- `{ "action": "resolveDispute", "disputeId", "outcome", "resolution" }` — staff only (the `p2p.resolve` permission is enforced inside the RPC against the caller). Releases to buyer or refunds to seller.
- `{ "action": "paymentDetails", "orderId" }` — returns the seller's payable account details **only to the two order participants** (never `encrypted_details` to anyone else).

CORS preflight (`OPTIONS`) is handled so the browser SDK can invoke the function directly. Order rows are never writable by browser clients — all state transitions go through these service-role RPCs.
