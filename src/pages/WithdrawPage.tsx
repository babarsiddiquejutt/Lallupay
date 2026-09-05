import { useCallback, useEffect, useState, useMemo, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Card, Button } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { getWallets } from '../lib/db/wallets';
import { getMyProfile } from '../lib/db/profiles';
import { requestWithdrawal } from '../lib/api/deposits';
import { formatAssetAmount } from '../lib/formatters';
import type { Wallet, Profile } from '../types/database';

export function WithdrawPage() {
  const { user } = useAuth();
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);

  const loadWallets = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    try {
      const [w, p] = await Promise.all([getWallets(user.id), getMyProfile(user.id)]);
      setWallets(w ?? []);
      setProfile(p);
    } catch { /* wallet is a display hint */ }
    finally { setLoading(false); }
  }, [user]);

  useEffect(() => { void loadWallets(); }, [loadWallets]);

  const usdtBalance = useMemo(() => {
    const wallet = wallets.find((w) => w.asset_code === 'USDT');
    return wallet ? Number(wallet.balance_snapshot) : 0;
  }, [wallets]);

  const kycApproved = profile?.kyc_status === 'approved';

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!user) return;
    setError(''); setNotice('');

    if (!kycApproved) {
      setError('KYC verification is required before you can withdraw. Please verify your identity first.');
      return;
    }

    if (!address.trim() || address.trim().length < 10) {
      setError('Please enter a valid TRC20 wallet address.');
      return;
    }
    const amountNum = Number(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setError('Please enter a valid withdrawal amount.');
      return;
    }
    if (amountNum > usdtBalance) {
      setError('Insufficient USDT balance.');
      return;
    }

    setBusy(true);
    try {
      await requestWithdrawal({ amount, address: address.trim(), idempotencyKey: crypto.randomUUID() });
      setNotice('Withdrawal request submitted. It will be processed after admin approval.');
      setAmount(''); setAddress('');
      void loadWallets();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to submit withdrawal.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <main className="page"><p>Loading withdrawal…</p></main>;

  return (
    <main className="page">
      <div className="hero">
        <span className="eyebrow">LALLUPAY</span>
        <h1>Withdraw USDT</h1>
        <p>Withdraw your USDT to any TRC20 wallet address. KYC verification is required.</p>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="eyebrow" role="status">{notice}</p>}

      <Card>
        <div className="section-heading">
          <h2>Available balance</h2>
        </div>
        <p style={{ fontSize: '1.5rem', fontWeight: 700 }}>{formatAssetAmount(String(usdtBalance), 'USDT')}</p>
      </Card>

      {!kycApproved && (
        <Card>
          <h2>KYC verification required</h2>
          <p>You must complete identity verification before you can make withdrawals.</p>
          <div style={{ marginTop: '1rem' }}>
            <Link to="/kyc">
              <Button>Verify identity →</Button>
            </Link>
          </div>
          {profile?.kyc_status === 'rejected' && (
            <p style={{ marginTop: '0.75rem' }}><small style={{ color: 'var(--color-error)' }}>Your previous KYC submission was rejected. Please submit new documents.</small></p>
          )}
          {profile?.kyc_status === 'pending' && (
            <p style={{ marginTop: '0.75rem' }}><small>Your KYC submission is under review. You will be notified once it is processed.</small></p>
          )}
        </Card>
      )}

      {kycApproved && (
        <Card>
          <h2>Withdrawal details</h2>
          <form onSubmit={(event) => void handleSubmit(event)}>
            <label>TRC20 wallet address
              <input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Enter your TRC20 address" required />
              <small>Double-check the address. Transactions cannot be reversed.</small>
            </label>
            <label>Amount (USDT)
              <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" required />
              <small>Available: {formatAssetAmount(String(usdtBalance), 'USDT')}</small>
            </label>
            <Button type="submit" disabled={busy}>
              {busy ? 'Submitting…' : 'Request withdrawal'}
            </Button>
          </form>
        </Card>
      )}

      <Card>
        <h2>Important notes</h2>
        <ul className="transaction-list">
          <li><span>Network</span><span>TRON (TRC20) only</span></li>
          <li><span>KYC required</span><span>You must have approved KYC to withdraw</span></li>
          <li><span>Processing time</span><span>Typically within 24 hours after admin approval</span></li>
          <li><span>Fee</span><span>Network fee may apply (configured by admin)</span></li>
        </ul>
        <p><small>Withdrawals are reviewed by our team to ensure security. You will receive a notification when your withdrawal is processed.</small></p>
      </Card>
    </main>
  );
}
