import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { getWallets } from '../lib/db/wallets';
import { resolveRecipient, requestInternalTransfer, type LookupMethod, type ResolvedRecipient } from '../lib/api/transfers';
import { formatAssetAmount } from '../lib/formatters';
import type { AssetCode, Wallet } from '../types/database';

type Step = 'recipient' | 'amount' | 'review' | 'done';
const lookupLabels: Record<LookupMethod, string> = { username: 'Username', email: 'Email', mobile: 'Mobile number' };
const amountPattern: Record<AssetCode, RegExp> = { PKR: /^\d+(\.\d{1,2})?$/, USDT: /^\d+(\.\d{1,8})?$/ };

/** Server-authoritative internal transfer. Every balance decision, recipient check, and ledger write happens in the Edge Function + RPC. */
export function TransferPage() {
  const { user } = useAuth();
  const [step, setStep] = useState<Step>('recipient');
  const [method, setMethod] = useState<LookupMethod>('username');
  const [value, setValue] = useState('');
  const [recipient, setRecipient] = useState<ResolvedRecipient | null>(null);
  const [asset, setAsset] = useState<AssetCode>('PKR');
  const [amount, setAmount] = useState('');
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [resultTxId, setResultTxId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadWallets = useCallback(async () => {
    if (!user) return;
    try { setWallets(await getWallets(user.id)); } catch { /* balances are a display hint only; the server is authoritative */ }
  }, [user]);

  useEffect(() => { void loadWallets(); }, [loadWallets]);

  const availableBalance = useMemo(() => wallets.find((wallet) => wallet.asset_code === asset)?.balance_snapshot ?? '0', [wallets, asset]);
  // Client-side hint only — the RPC re-checks the ledger balance under an advisory lock before moving any funds.
  const exceedsBalance = useMemo(() => amount !== '' && Number(amount) > Number(availableBalance), [amount, availableBalance]);

  async function findRecipient(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    if (value.trim().length === 0) { setError('Enter a recipient to continue.'); return; }
    setBusy(true);
    try {
      const resolved = await resolveRecipient(method, value.trim());
      if (resolved.isSelf) { setError('You cannot transfer to yourself.'); return; }
      setRecipient(resolved);
      setStep('amount');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to find that recipient.');
    } finally {
      setBusy(false);
    }
  }

  function reviewAmount(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    if (!amountPattern[asset].test(amount) || Number(amount) === 0) { setError(`Enter a valid ${asset} amount (up to ${asset === 'PKR' ? 2 : 8} decimal places).`); return; }
    if (exceedsBalance) { setError('Amount exceeds your available balance.'); return; }
    setIdempotencyKey(crypto.randomUUID());
    setStep('review');
  }

  async function confirmTransfer() {
    if (!recipient || !idempotencyKey) return;
    setError('');
    setBusy(true);
    try {
      const { transactionId } = await requestInternalTransfer({ recipientId: recipient.recipientId, asset, amount, idempotencyKey, lookupMethod: method });
      setResultTxId(transactionId);
      setStep('done');
      void loadWallets();
    } catch (reason) {
      // Stay on the review step so a retry reuses the same idempotency key (no double send).
      setError(reason instanceof Error ? reason.message : 'The transfer could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  function restart() {
    setStep('recipient'); setRecipient(null); setValue(''); setAmount(''); setIdempotencyKey(''); setResultTxId(''); setError('');
  }

  const recipientName = recipient?.fullName ?? (recipient?.username ? `@${recipient.username}` : 'this recipient');

  return (
    <main className="page">
      <div className="hero">
        <span className="eyebrow">SANDBOX — NO REAL FUNDS</span>
        <h1>Send money</h1>
        <p>Transfer instantly to another LaluPay account. Recipients, balances, and fees are all verified on the server.</p>
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      {step === 'recipient' && (
        <Card>
          <form onSubmit={findRecipient}>
            <label>Find recipient by
              <select value={method} onChange={(event) => setMethod(event.target.value as LookupMethod)}>
                <option value="username">Username</option>
                <option value="email">Email</option>
                <option value="mobile">Mobile number</option>
              </select>
            </label>
            <label>{lookupLabels[method]}
              <input value={value} onChange={(event) => setValue(event.target.value)} placeholder={method === 'username' ? 'e.g. jamal_k' : method === 'email' ? 'name@example.com' : '03xxxxxxxxx'} autoComplete="off" required />
            </label>
            <Button type="submit" disabled={busy}>{busy ? 'Searching…' : 'Find recipient'}</Button>
          </form>
        </Card>
      )}

      {step === 'amount' && recipient && (
        <Card>
          <div className="section-heading"><h2>Recipient</h2><button type="button" className="link-button" onClick={restart}>Change</button></div>
          <p>{recipient.fullName ? <strong>{recipient.fullName}</strong> : <strong>@{recipient.username}</strong>}{recipient.fullName && recipient.username ? <> · @{recipient.username}</> : null}</p>
          <form onSubmit={reviewAmount}>
            <label>Asset
              <select value={asset} onChange={(event) => { setAsset(event.target.value as AssetCode); setError(''); }}>
                <option value="PKR">PKR</option>
                <option value="USDT">USDT</option>
              </select>
            </label>
            <label>Amount
              <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" required />
            </label>
            <small>Available: {formatAssetAmount(availableBalance, asset)}</small>
            <Button type="submit" disabled={busy || exceedsBalance}>Review transfer</Button>
          </form>
        </Card>
      )}

      {step === 'review' && recipient && (
        <Card>
          <div className="section-heading"><h2>Review</h2><button type="button" className="link-button" onClick={() => { setStep('amount'); setError(''); }}>Edit</button></div>
          <ul className="transaction-list">
            <li><span>To</span><span><strong>{recipientName}</strong></span></li>
            <li><span>Amount</span><span><strong>{formatAssetAmount(amount, asset)}</strong></span></li>
            <li><span>Fee</span><span>{formatAssetAmount('0', asset)}</span></li>
          </ul>
          <p><small>You'll send exactly {formatAssetAmount(amount, asset)}. This can't be undone once confirmed.</small></p>
          <Button onClick={() => void confirmTransfer()} disabled={busy}>{busy ? 'Sending…' : 'Confirm & send'}</Button>
        </Card>
      )}

      {step === 'done' && (
        <Card>
          <span className="eyebrow">Transfer complete</span>
          <h2>You sent {formatAssetAmount(amount, asset)}</h2>
          <p>Sent to {recipientName}. Your balances update in real time.</p>
          <p><small>Reference: TRF-{resultTxId}</small></p>
          <div className="section-heading" style={{ gap: '1rem' }}>
            <Button onClick={restart}>Send another</Button>
            <Link to="/wallet">View wallet →</Link>
          </div>
        </Card>
      )}
    </main>
  );
}
