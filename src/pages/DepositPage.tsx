import { useCallback, useState, type FormEvent } from 'react';
import { Card } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { submitDeposit } from '../lib/api/deposits';

const USDT_TRC20_ADDRESS = 'TC3pAKKwtvGz8rkweKKsk22KJbNP1KKT4h';

export function DepositPage() {
  const { user } = useAuth();
  const [txid, setTxid] = useState('');
  const [amount, setAmount] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);

  const copyAddress = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(USDT_TRC20_ADDRESS);
      setCopied(true);
      setNotice('TRON deposit address copied.');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select the text so user can manually copy
      const el = document.getElementById('deposit-address');
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      setError('Automatic copy not supported. Please select and copy the address manually.');
    }
  }, []);

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
      await submitDeposit({ txid: txid.trim(), amount, address: address.trim() || USDT_TRC20_ADDRESS });
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
        <p>Send USDT to the platform wallet below, then submit the transaction details for confirmation.</p>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="eyebrow" role="status">{notice}</p>}

      {/* ── Deposit Address Card ── */}
      <Card>
        <h2>USDT Deposit</h2>
        <ul className="transaction-list">
          <li><span>Network</span><span><strong>TRON (TRC20)</strong></span></li>
          <li><span>Asset</span><span><strong>USDT</strong></span></li>
          <li><span>Minimum deposit</span><span>No minimum</span></li>
          <li><span>Confirmation time</span><span>Typically within 1 hour</span></li>
        </ul>

        <div style={{ marginTop: '1.25rem' }}>
          <span style={{ fontSize: '0.8125rem', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            Receiving address
          </span>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            marginTop: '0.5rem',
            padding: '0.75rem 1rem',
            background: 'var(--bg-elevated, #ffffff08)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border, #ffffff12)',
            flexWrap: 'wrap',
          }}>
            <code
              id="deposit-address"
              style={{
                flex: 1,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                fontSize: 'clamp(0.8125rem, 2.5vw, 1rem)',
                fontWeight: 600,
                wordBreak: 'break-all',
                userSelect: 'all',
                color: 'var(--text-primary, #fff)',
              }}
            >
              {USDT_TRC20_ADDRESS}
            </code>
            <button
              type="button"
              className="button secondary"
              onClick={() => void copyAddress()}
              style={{
                width: 'auto',
                minWidth: '120px',
                flexShrink: 0,
              }}
            >
              {copied ? '✓ Copied' : 'Copy Address'}
            </button>
          </div>
        </div>

        {/* Warning */}
        <p style={{
          marginTop: '1rem',
          padding: '0.75rem 1rem',
          borderRadius: 'var(--radius-md)',
          background: 'rgba(255, 180, 0, 0.08)',
          border: '1px solid rgba(255, 180, 0, 0.25)',
          fontSize: '0.8125rem',
          lineHeight: 1.5,
          color: 'var(--color-warning, #fbbf24)',
        }}>
          ⚠️ <strong>Send USDT only through the TRON (TRC20) network to this address.</strong><br />
          Sending assets through another network may result in permanent loss of funds.
        </p>
      </Card>

      {/* ── Submit Deposit Form ── */}
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
          <label>Sent to address (optional — defaults to platform address)
            <input value={address} onChange={(event) => setAddress(event.target.value)} placeholder={USDT_TRC20_ADDRESS} />
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
