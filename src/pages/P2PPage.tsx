import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button, Card, EmptyState } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { formatAssetAmount, formatTimestamp } from '../lib/formatters';
import { subscribeToTable } from '../lib/realtime';
import {
  getActiveSellAdvertisements, getMyAdvertisements, createSellAdvertisement, setAdvertisementStatus,
  getMyOrders, getOrder, getOrderMessages, sendOrderMessage, getOrderDispute,
  getMyPaymentMethods, createPaymentMethod, uploadPaymentProof, getPaymentProofUrl,
} from '../lib/db/p2p';
import {
  createSellOrder, markPaymentSent, releaseOrder, cancelOrder, openDispute, getOrderPaymentDetails,
  type OrderPaymentDetails,
} from '../lib/api/p2p';
import type { P2pAdvertisement, P2pOrder, OrderMessage, PaymentMethod, PaymentMethodType, P2pOrderStatus, P2pDispute } from '../types/database';

// PKR is the fiat leg (2 dp); price is PKR-per-USDT stored to 6 dp. Client validation is a courtesy — the RPC re-validates everything.
const pkrPattern = /^\d+(\.\d{1,2})?$/;
const pricePattern = /^\d+(\.\d{1,6})?$/;
const shortId = (id: string) => `#${id.slice(0, 8)}`;
const trimNum = (value: string) => (value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value);
const methodLabels: Record<PaymentMethodType, string> = { bank: 'Bank transfer', jazzcash: 'JazzCash', easypaisa: 'Easypaisa' };
// Map the six order states onto the palette that already exists in styles.css — no new CSS.
const statusMeta: Record<P2pOrderStatus, { label: string; cls: string }> = {
  created: { label: 'Awaiting payment', cls: 'pending' },
  payment_sent: { label: 'Payment sent', cls: 'review' },
  completed: { label: 'Completed', cls: 'completed' },
  cancelled: { label: 'Cancelled', cls: 'cancelled' },
  expired: { label: 'Expired', cls: 'failed' },
  disputed: { label: 'Disputed', cls: 'review' },
};

type View = 'market' | 'orders' | 'sell';
const tabLabels: Record<View, string> = { market: 'Buy USDT', orders: 'My orders', sell: 'Sell / offers' };

// ---------- Marketplace: browse active sell offers and open an order ----------

function MarketTab({ userId, onOpenOrder }: { userId: string; onOpenOrder: (orderId: string) => void }) {
  const [ads, setAds] = useState<P2pAdvertisement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeAdId, setActiveAdId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setError(''); setAds(await getActiveSellAdvertisements()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load offers.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // A user cannot take their own advertisement (the RPC rejects it too).
  const offers = useMemo(() => ads.filter((ad) => ad.owner_id !== userId), [ads, userId]);

  async function submitOrder(ad: P2pAdvertisement) {
    setError('');
    if (!pkrPattern.test(amount) || Number(amount) === 0) { setError('Enter a valid PKR amount (up to 2 decimals).'); return; }
    if (Number(amount) < Number(ad.min_amount) || Number(amount) > Number(ad.max_amount)) { setError('Amount is outside the advertised limits.'); return; }
    setBusy(true);
    try {
      const { orderId } = await createSellOrder({ advertisementId: ad.id, amount, idempotencyKey: crypto.randomUUID() });
      setActiveAdId(null); setAmount('');
      onOpenOrder(orderId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to open the order.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p>Loading offers…</p>;
  return (
    <>
      {error && <p className="error" role="alert">{error}</p>}
      {offers.length ? offers.map((ad) => (
        <Card key={ad.id}>
          <div className="section-heading"><h2>{trimNum(ad.price)} PKR/USDT</h2><span className="status">Seller {shortId(ad.owner_id)}</span></div>
          <ul className="transaction-list">
            <li><span>Limits</span><span>{formatAssetAmount(ad.min_amount, 'PKR')} – {formatAssetAmount(ad.max_amount, 'PKR')}</span></li>
            <li><span>Payment window</span><span>{ad.payment_window_minutes} min</span></li>
          </ul>
          {activeAdId === ad.id ? (
            <form onSubmit={(event) => { event.preventDefault(); void submitOrder(ad); }}>
              <label>You pay (PKR)
                <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" required />
              </label>
              {pkrPattern.test(amount) && Number(amount) > 0 && Number(ad.price) > 0 && (
                <small>You receive ≈ {formatAssetAmount((Number(amount) / Number(ad.price)).toFixed(8), 'USDT')}</small>
              )}
              <small>The seller's USDT is escrowed by LaluPay. You pay PKR directly to the seller — their payment details appear once the order opens.</small>
              <div className="section-heading" style={{ gap: '1rem' }}>
                <Button type="submit" disabled={busy}>{busy ? 'Opening…' : 'Open order'}</Button>
                <button type="button" className="link-button" onClick={() => { setActiveAdId(null); setAmount(''); setError(''); }}>Cancel</button>
              </div>
            </form>
          ) : (
            <Button onClick={() => { setActiveAdId(ad.id); setAmount(''); setError(''); }}>Buy USDT</Button>
          )}
        </Card>
      )) : <EmptyState title="No offers available" body="There are no active USDT sell offers right now. Check back soon." />}
    </>
  );
}

// ---------- The caller's orders (as buyer or seller) ----------

function OrdersTab({ userId, onOpenOrder }: { userId: string; onOpenOrder: (orderId: string) => void }) {
  const [orders, setOrders] = useState<P2pOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { setError(''); setOrders(await getMyOrders(userId)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load your orders.'); }
    finally { setLoading(false); }
  }, [userId]);

  useEffect(() => {
    void load();
    const unsubscribeBuyer = subscribeToTable('p2p_orders', `buyer_id=eq.${userId}`, () => { void load(); });
    const unsubscribeSeller = subscribeToTable('p2p_orders', `seller_id=eq.${userId}`, () => { void load(); });
    return () => { unsubscribeBuyer(); unsubscribeSeller(); };
  }, [load, userId]);

  if (loading) return <p>Loading orders…</p>;
  return (
    <>
      {error && <p className="error" role="alert">{error}</p>}
      <section className="card">
        <div className="section-heading"><h2>Your orders</h2><span>{orders.length} records</span></div>
        {orders.length ? (
          <ul className="transaction-list">
            {orders.map((order) => (
              <li key={order.id} style={{ cursor: 'pointer' }} onClick={() => onOpenOrder(order.id)}>
                <span>{order.buyer_id === userId ? 'Buy' : 'Sell'} · {formatAssetAmount(order.crypto_amount ?? '0', 'USDT')}</span>
                <span>{formatAssetAmount(order.amount, 'PKR')}</span>
                <span className={`status ${statusMeta[order.status].cls}`}>{statusMeta[order.status].label}</span>
              </li>
            ))}
          </ul>
        ) : <EmptyState title="No orders yet" body="Orders you open from the marketplace, and orders placed against your offers, appear here." />}
      </section>
    </>
  );
}

// ---------- Single order: settlement, actions, proof, and realtime chat ----------

function OrderDetail({ orderId, userId, onBack }: { orderId: string; userId: string; onBack: () => void }) {
  const [order, setOrder] = useState<P2pOrder | null>(null);
  const [messages, setMessages] = useState<OrderMessage[]>([]);
  const [dispute, setDispute] = useState<P2pDispute | null>(null);
  const [payment, setPayment] = useState<OrderPaymentDetails | null>(null);
  const [messageText, setMessageText] = useState('');
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [disputeReason, setDisputeReason] = useState('');
  const [showDispute, setShowDispute] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadOrder = useCallback(async () => {
    try { setOrder(await getOrder(orderId)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load the order.'); }
  }, [orderId]);
  const loadMessages = useCallback(async () => {
    try { setMessages(await getOrderMessages(orderId)); } catch { /* chat is non-critical */ }
  }, [orderId]);

  useEffect(() => { void loadOrder(); void loadMessages(); }, [loadOrder, loadMessages]);

  // Realtime: reflect status changes from the counterparty and new chat messages.
  useEffect(() => {
    const unsubscribeOrder = subscribeToTable('p2p_orders', `id=eq.${orderId}`, () => { void loadOrder(); });
    const unsubscribeMessages = subscribeToTable('order_messages', `order_id=eq.${orderId}`, () => { void loadMessages(); });
    return () => { unsubscribeOrder(); unsubscribeMessages(); };
  }, [orderId, loadOrder, loadMessages]);

  const status = order?.status;
  const isBuyer = order?.buyer_id === userId;
  const isSeller = order?.seller_id === userId;

  // Payment details are disclosed server-side to participants only; fetch them while settlement is in flight.
  useEffect(() => {
    if (status !== 'created' && status !== 'payment_sent' && status !== 'disputed') return;
    getOrderPaymentDetails(orderId).then(setPayment).catch(() => setPayment(null));
    if (status === 'disputed') getOrderDispute(orderId).then(setDispute).catch(() => { /* dispute detail is optional */ });
  }, [status, orderId]);

  async function act(action: () => Promise<unknown>, ok: string) {
    setError(''); setNotice(''); setBusy(true);
    try { await action(); setNotice(ok); await loadOrder(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'The action could not be completed.'); }
    finally { setBusy(false); }
  }

  async function submitPaymentSent() {
    setError(''); setNotice(''); setBusy(true);
    try {
      const proofPath = proofFile ? await uploadPaymentProof(orderId, proofFile) : undefined;
      await markPaymentSent({ orderId, proofPath });
      setProofFile(null); setNotice('Payment marked as sent. Waiting for the seller to confirm receipt.');
      await loadOrder();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to mark payment as sent.');
    } finally {
      setBusy(false);
    }
  }

  async function submitDispute() {
    if (disputeReason.trim().length < 5) { setError('Enter a dispute reason of at least 5 characters.'); return; }
    setError(''); setNotice(''); setBusy(true);
    try {
      await openDispute({ orderId, reason: disputeReason.trim() });
      setShowDispute(false); setDisputeReason(''); setNotice('Dispute opened. A staff member will review it.');
      await loadOrder();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to open a dispute.');
    } finally {
      setBusy(false);
    }
  }

  async function submitMessage(event: FormEvent) {
    event.preventDefault();
    const body = messageText.trim();
    if (!body) return;
    setMessageText('');
    try { await sendOrderMessage(orderId, userId, body); await loadMessages(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Message failed to send.'); }
  }

  async function viewProof() {
    if (!order?.payment_proof_path) return;
    try { const url = await getPaymentProofUrl(order.payment_proof_path); if (url) window.open(url, '_blank', 'noopener'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to open the proof.'); }
  }

  const counterpartyId = order ? (isBuyer ? order.seller_id : order.buyer_id) : '';

  return (
    <>
      <button type="button" className="link-button" onClick={onBack}>← Back to orders</button>
      {!order ? <p>Loading order…</p> : (
        <>
          {error && <p className="error" role="alert">{error}</p>}
          {notice && <p className="eyebrow" role="status">{notice}</p>}

          <Card>
            <div className="section-heading">
              <h2>{isBuyer ? 'Buying' : 'Selling'} {formatAssetAmount(order.crypto_amount ?? '0', 'USDT')}</h2>
              <span className={`status ${statusMeta[order.status].cls}`}>{statusMeta[order.status].label}</span>
            </div>
            <ul className="transaction-list">
              <li><span>You pay / receive</span><span><strong>{formatAssetAmount(order.amount, 'PKR')}</strong></span></li>
              <li><span>Price</span><span>{order.price ? `${trimNum(order.price)} PKR/USDT` : '—'}</span></li>
              <li><span>{isBuyer ? 'Seller' : 'Buyer'}</span><span>{shortId(counterpartyId)}</span></li>
              {order.status === 'created' && <li><span>Pay before</span><span>{formatTimestamp(order.expires_at)}</span></li>}
              <li><span>Opened</span><span>{formatTimestamp(order.created_at)}</span></li>
            </ul>
            {order.payment_proof_path && <button type="button" className="link-button" onClick={() => void viewProof()}>View payment proof</button>}
          </Card>

          {payment && (order.status === 'created' || order.status === 'payment_sent' || order.status === 'disputed') && (
            <Card>
              <span className="eyebrow">{isBuyer ? 'Pay PKR to the seller' : 'Your receiving account'}</span>
              <ul className="transaction-list">
                <li><span>Method</span><span>{methodLabels[payment.methodType]}</span></li>
                <li><span>Account name</span><span>{payment.accountName}</span></li>
                <li><span>Account / number</span><span><strong>{payment.payableDetail}</strong></span></li>
              </ul>
              {isBuyer && <p><small>Send exactly {formatAssetAmount(order.amount, 'PKR')} using the details above, then mark the payment as sent. LaluPay never holds your PKR.</small></p>}
            </Card>
          )}

          <Card>
            <div className="section-heading"><h2>Next step</h2></div>
            {order.status === 'created' && isBuyer && (
              <>
                <p>Pay the seller in PKR, optionally attach proof, then confirm.</p>
                <label>Payment proof (optional)
                  <input type="file" accept="image/png,image/jpeg,application/pdf" onChange={(event) => setProofFile(event.target.files?.[0] ?? null)} />
                </label>
                <div className="section-heading" style={{ gap: '1rem' }}>
                  <Button onClick={() => void submitPaymentSent()} disabled={busy}>{busy ? 'Submitting…' : "I've paid — mark payment sent"}</Button>
                  <Button className="secondary" onClick={() => void act(() => cancelOrder(orderId), 'Order cancelled and escrow refunded to the seller.')} disabled={busy}>Cancel order</Button>
                </div>
              </>
            )}
            {order.status === 'created' && isSeller && (
              <>
                <p>Waiting for the buyer to pay in PKR. Your {formatAssetAmount(order.crypto_amount ?? '0', 'USDT')} is held in escrow until then.</p>
                <Button className="secondary" onClick={() => void act(() => cancelOrder(orderId), 'Order cancelled and your escrow was refunded.')} disabled={busy}>Cancel order</Button>
              </>
            )}
            {order.status === 'payment_sent' && isSeller && (
              <>
                <p>The buyer marked payment as sent. Confirm the PKR arrived in your account, then release the USDT.</p>
                <div className="section-heading" style={{ gap: '1rem' }}>
                  <Button onClick={() => void act(() => releaseOrder(orderId), 'USDT released to the buyer. Order complete.')} disabled={busy}>{busy ? 'Releasing…' : 'Confirm receipt & release USDT'}</Button>
                  <Button className="secondary" onClick={() => setShowDispute((value) => !value)} disabled={busy}>Open dispute</Button>
                </div>
              </>
            )}
            {order.status === 'payment_sent' && isBuyer && (
              <>
                <p>Payment sent. Waiting for the seller to confirm receipt and release your USDT.</p>
                <Button className="secondary" onClick={() => setShowDispute((value) => !value)} disabled={busy}>Open dispute</Button>
              </>
            )}
            {order.status === 'disputed' && (
              <>
                <p>This order is under dispute and the escrow is frozen until staff resolve it.</p>
                {dispute && <p><small>Reason: {dispute.reason}</small></p>}
              </>
            )}
            {order.status === 'completed' && <p>Completed. The escrowed USDT was released to the buyer.</p>}
            {order.status === 'cancelled' && <p>Cancelled. The escrowed USDT was refunded to the seller.</p>}
            {order.status === 'expired' && <p>Expired before payment was confirmed. The escrow was refunded to the seller.</p>}

            {showDispute && (order.status === 'payment_sent') && (
              <form onSubmit={(event) => { event.preventDefault(); void submitDispute(); }}>
                <label>What went wrong?
                  <input value={disputeReason} onChange={(event) => setDisputeReason(event.target.value)} placeholder="Describe the payment issue" required />
                </label>
                <Button type="submit" disabled={busy}>Submit dispute</Button>
              </form>
            )}
          </Card>

          <section className="card">
            <div className="section-heading"><h2>Messages</h2><span>{messages.length}</span></div>
            {messages.length ? (
              <div style={{ display: 'grid', gap: '.75rem', margin: '1rem 0' }}>
                {messages.map((message) => (
                  <div key={message.id} style={{ justifySelf: message.sender_id === userId ? 'end' : 'start', maxWidth: '80%' }}>
                    <div style={{ background: message.sender_id === userId ? '#6366f133' : '#ffffff12', border: '1px solid #ffffff1a', borderRadius: '12px', padding: '.6rem .8rem' }}>{message.body}</div>
                    <small style={{ color: '#c5c8dc' }}>{message.sender_id === userId ? 'You' : shortId(message.sender_id)} · {formatTimestamp(message.created_at)}</small>
                  </div>
                ))}
              </div>
            ) : <EmptyState title="No messages yet" body="Coordinate the payment with your counterparty here." />}
            <form onSubmit={submitMessage}>
              <label>Message
                <input value={messageText} onChange={(event) => setMessageText(event.target.value)} placeholder="Type a message" maxLength={2000} />
              </label>
              <Button type="submit" disabled={!messageText.trim()}>Send</Button>
            </form>
          </section>
        </>
      )}
    </>
  );
}

// ---------- Seller tools: payment methods and sell offers ----------

function SellTab({ userId }: { userId: string }) {
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [ads, setAds] = useState<P2pAdvertisement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [pmType, setPmType] = useState<PaymentMethodType>('easypaisa');
  const [pmName, setPmName] = useState('');
  const [pmDetail, setPmDetail] = useState('');

  const [price, setPrice] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [methodId, setMethodId] = useState('');
  const [windowMins, setWindowMins] = useState('30');

  const load = useCallback(async () => {
    try {
      setError('');
      const [nextMethods, nextAds] = await Promise.all([getMyPaymentMethods(userId), getMyAdvertisements(userId)]);
      setMethods(nextMethods); setAds(nextAds);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load your seller tools.');
    } finally {
      setLoading(false);
    }
  }, [userId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setMethodId((current) => current || methods[0]?.id || ''); }, [methods]);

  async function submitMethod(event: FormEvent) {
    event.preventDefault(); setError('');
    if (pmName.trim().length < 2) { setError('Enter the account holder name.'); return; }
    if (pmDetail.trim().length < 4) { setError('Enter a valid account or wallet number.'); return; }
    setBusy(true);
    try {
      await createPaymentMethod({ userId, methodType: pmType, accountName: pmName.trim(), detail: pmDetail.trim() });
      setPmName(''); setPmDetail(''); await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save the payment method.');
    } finally {
      setBusy(false);
    }
  }

  async function submitAd(event: FormEvent) {
    event.preventDefault(); setError('');
    if (!pricePattern.test(price) || Number(price) === 0) { setError('Enter a valid price (PKR per USDT, up to 6 decimals).'); return; }
    if (!pkrPattern.test(minAmount) || !pkrPattern.test(maxAmount) || Number(minAmount) === 0) { setError('Enter valid PKR limits (up to 2 decimals).'); return; }
    if (Number(minAmount) > Number(maxAmount)) { setError('Minimum cannot exceed maximum.'); return; }
    const mins = Number(windowMins);
    if (!Number.isInteger(mins) || mins < 5 || mins > 1440) { setError('Payment window must be 5–1440 minutes.'); return; }
    if (!methodId) { setError('Add a payment method before publishing an offer.'); return; }
    setBusy(true);
    try {
      await createSellAdvertisement({ ownerId: userId, price, minAmount, maxAmount, paymentMethodId: methodId, paymentWindowMinutes: mins });
      setPrice(''); setMinAmount(''); setMaxAmount(''); await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to publish the offer.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleAd(ad: P2pAdvertisement) {
    try { await setAdvertisementStatus(ad.id, ad.status === 'active' ? 'paused' : 'active'); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to update the offer.'); }
  }
  async function closeAd(ad: P2pAdvertisement) {
    try { await setAdvertisementStatus(ad.id, 'closed'); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to close the offer.'); }
  }

  if (loading) return <p>Loading seller tools…</p>;
  return (
    <>
      {error && <p className="error" role="alert">{error}</p>}

      <section className="card">
        <div className="section-heading"><h2>Payment methods</h2><span>{methods.length}</span></div>
        {methods.length ? (
          <ul className="transaction-list">
            {methods.map((method) => (
              <li key={method.id}><span>{methodLabels[method.method_type]}</span><span>{method.account_name}</span><span>{method.account_reference_masked}</span></li>
            ))}
          </ul>
        ) : <EmptyState title="No payment methods" body="Add the Easypaisa, JazzCash, or bank account where buyers will send you PKR." />}
        <form onSubmit={submitMethod}>
          <label>Type
            <select value={pmType} onChange={(event) => setPmType(event.target.value as PaymentMethodType)}>
              <option value="easypaisa">Easypaisa</option>
              <option value="jazzcash">JazzCash</option>
              <option value="bank">Bank transfer</option>
            </select>
          </label>
          <label>Account holder name
            <input value={pmName} onChange={(event) => setPmName(event.target.value)} placeholder="e.g. Ayesha Khan" autoComplete="off" required />
          </label>
          <label>Account / wallet number
            <input value={pmDetail} onChange={(event) => setPmDetail(event.target.value)} placeholder="e.g. 03xxxxxxxxx" autoComplete="off" required />
          </label>
          <Button type="submit" disabled={busy}>Add payment method</Button>
        </form>
      </section>

      <section className="card">
        <div className="section-heading"><h2>Your sell offers</h2><span>{ads.length}</span></div>
        {ads.length ? (
          <ul className="transaction-list">
            {ads.map((ad) => (
              <li key={ad.id}>
                <span>{trimNum(ad.price)} PKR/USDT</span>
                <span>{formatAssetAmount(ad.min_amount, 'PKR')} – {formatAssetAmount(ad.max_amount, 'PKR')}</span>
                <span style={{ display: 'flex', gap: '.75rem', alignItems: 'center' }}>
                  <span className={`status ${ad.status === 'active' ? 'completed' : ad.status === 'paused' ? 'review' : 'cancelled'}`}>{ad.status}</span>
                  {ad.status !== 'closed' && <button type="button" className="link-button" style={{ padding: 0 }} onClick={() => void toggleAd(ad)}>{ad.status === 'active' ? 'Pause' : 'Activate'}</button>}
                  {ad.status !== 'closed' && <button type="button" className="link-button" style={{ padding: 0 }} onClick={() => void closeAd(ad)}>Close</button>}
                </span>
              </li>
            ))}
          </ul>
        ) : <EmptyState title="No offers yet" body="Publish a sell offer below. Your USDT is only escrowed when a buyer opens an order against it." />}
        <form onSubmit={submitAd}>
          <label>Price (PKR per USDT)
            <input inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="e.g. 290.50" required />
          </label>
          <label>Minimum order (PKR)
            <input inputMode="decimal" value={minAmount} onChange={(event) => setMinAmount(event.target.value)} placeholder="0.00" required />
          </label>
          <label>Maximum order (PKR)
            <input inputMode="decimal" value={maxAmount} onChange={(event) => setMaxAmount(event.target.value)} placeholder="0.00" required />
          </label>
          <label>Receiving account
            <select value={methodId} onChange={(event) => setMethodId(event.target.value)}>
              {methods.length ? methods.map((method) => <option key={method.id} value={method.id}>{methodLabels[method.method_type]} · {method.account_reference_masked}</option>) : <option value="">Add a payment method first</option>}
            </select>
          </label>
          <label>Payment window (minutes)
            <input inputMode="numeric" value={windowMins} onChange={(event) => setWindowMins(event.target.value)} placeholder="30" required />
          </label>
          <Button type="submit" disabled={busy || !methods.length}>Publish sell offer</Button>
        </form>
      </section>
    </>
  );
}

/** First-cut P2P marketplace: buy USDT from sellers (SELL offers only). USDT is escrowed by LaluPay; PKR is paid buyer→seller off-platform. */
export function P2PPage() {
  const { user } = useAuth();
  const [view, setView] = useState<View>('market');
  const [orderId, setOrderId] = useState<string | null>(null);

  if (!user) return null;
  return (
    <main className="page">
      <div className="hero">
        <span className="eyebrow">LALLUPAY</span>
        <h1>P2P marketplace</h1>
        <p>Buy USDT from sellers by paying PKR directly via Easypaisa, JazzCash, or bank transfer. The seller's USDT is escrowed by LaluPay until they confirm your payment.</p>
      </div>

      {orderId ? (
        <OrderDetail orderId={orderId} userId={user.id} onBack={() => setOrderId(null)} />
      ) : (
        <>
          <div className="section-heading" style={{ justifyContent: 'flex-start', gap: '1.25rem', marginBottom: '1rem' }}>
            {(Object.keys(tabLabels) as View[]).map((value) => (
              <button key={value} type="button" className="link-button" style={{ color: view === value ? '#fff' : undefined, fontWeight: view === value ? 700 : 400 }} onClick={() => setView(value)}>{tabLabels[value]}</button>
            ))}
          </div>
          {view === 'market' && <MarketTab userId={user.id} onOpenOrder={setOrderId} />}
          {view === 'orders' && <OrdersTab userId={user.id} onOpenOrder={setOrderId} />}
          {view === 'sell' && <SellTab userId={user.id} />}
        </>
      )}
    </main>
  );
}
