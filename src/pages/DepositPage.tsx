import { useState, type FormEvent } from 'react';
import { Card } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { submitDeposit } from '../lib/api/deposits';

export function DepositPage() {
  const { user } = useAuth();
  const [txid, setTxid] = useState('');
  const [amount, setAmount] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!user) return;
    setError(''); setNotice('');

    if (!txid.trim() || txid.trim().length < 10) {
      setError('Please enter a valid TRC20 transaction hash.');
      return;
    }
    if (!amount || Number(amount) <= 0) {
      setError('Please enter a valid amount.');
      return;
    }

    setBusy(true);
    try {
      await submitDeposit({ txid: txid.trim(), amount, address: address.trim() || undefined });
      setNotice('Deposit submitted successfully. Our team will review and confirm your deposit shortly.');
      setTxid(''); setAmount(''); setAddress('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to submit deposit.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <div className="hero">
        <span className="eyebrow">LALLUPAY</span>
        <h1>Deposit USDT</h1>
        <p>Send USDT (TRC20) to the platform wallet below, then submit the transaction details for confirmation.</p>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="eyebrow" role="status">{notice}</p>}

      <Card>
        <h2>Deposit instructions</h2>
        <ul className="transaction-list">
          <li><span>Network</span><span><strong>TRON (TRC20)</strong></span></li>
          <li><span>Asset</span><span><strong>USDT</strong></span></li>
          <li><span>Minimum deposit</span><span>No minimum</span></li>
          <li><span>Confirmation time</span><span>Typically within 1 hour</span></li>
        </ul>
        <p><small style={{ color: 'var(--color-warning)' }}>IMPORTANT: Only send USDT on the TRON (TRC20) network. Sending any other asset or network may result in permanent loss of funds.</small></p>
      </Card>

      <Card>
        <h2>Submit your deposit</h2>
        <p>After sending USDT, enter the transaction details below for admin review.</p>
        <form onSubmit={(event) => void handleSubmit(event)}>
          <label>Transaction hash (TXID)
            <input value={txid} onChange={(event) => setTxid(event.target.value)} placeholder="Enter the TRC20 transaction hash" required />
            <small>Find this in your wallet or exchange after sending the transaction.</small>
          </label>
          <label>Amount (USDT)
            <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" required />
          </label>
          <label>Receiving address (optional — the address you sent to)
            <input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="TRC20 wallet address" />
          </label>
          <button className="button" type="submit" disabled={busy}>
            {busy ? 'Submitting…' : 'Submit deposit for review'}
          </button>
        </form>
      </Card>

      <Card>
        <h2>What happens next?</h2>
        <ul className="transaction-list">
          <li><span>1. Submit</span><span>Enter your transaction hash and amount</span></li>
          <li><span>2. Review</span><span>Our team verifies the blockchain transaction</span></li>
          <li><span>3. Confirm</span><span>USDT is credited to your LaluPay wallet</span></li>
        </ul>
        <p><small>You will receive a notification once your deposit is confirmed.</small></p>
      </Card>
    </main>
  );
}
