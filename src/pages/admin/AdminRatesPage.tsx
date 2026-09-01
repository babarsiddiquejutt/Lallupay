import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Card } from '../../components/ui';
import { useAdmin } from '../../hooks/useAdmin';
import {
  adminSetRate, adminGetRate, adminSetFee, adminGetFees,
  type AdminRate, type AdminFee,
} from '../../lib/api/admin';
import { formatTimestamp } from '../../lib/formatters';

type Tab = 'rates' | 'fees';
const operations = ['deposit', 'withdrawal', 'conversion', 'transfer', 'p2p'] as const;
const assets = ['PKR', 'USDT'] as const;

export function AdminRatesPage() {
  const { role } = useAdmin();
  const [tab, setTab] = useState<Tab>('rates');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  // Rate state
  const [usdtRate, setUsdtRate] = useState<AdminRate | null>(null);
  const [buyRate, setBuyRate] = useState('');
  const [sellRate, setSellRate] = useState('');

  // Fee state
  const [fees, setFees] = useState<AdminFee[]>([]);
  const [feeOperation, setFeeOperation] = useState<string>('conversion');
  const [feeAsset, setFeeAsset] = useState<string>('USDT');
  const [flatAmount, setFlatAmount] = useState('0');
  const [percentage, setPercentage] = useState('0');

  const loadRates = useCallback(async () => {
    try {
      const rate = await adminGetRate('USDT');
      setUsdtRate(rate);
      if (rate) {
        setBuyRate(String(rate.buy_rate));
        setSellRate(String(rate.sell_rate));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load rates.');
    }
  }, []);

  const loadFees = useCallback(async () => {
    try {
      setFees(await adminGetFees());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load fees.');
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    await Promise.all([loadRates(), loadFees()]);
    setLoading(false);
  }, [loadRates, loadFees]);

  useEffect(() => { void load(); }, [load]);

  async function saveRate(event: FormEvent) {
    event.preventDefault(); setError(''); setNotice(''); setBusy(true);
    try {
      await adminSetRate('USDT', buyRate, sellRate);
      setNotice('Exchange rate updated successfully.');
      void loadRates();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update rate.');
    } finally {
      setBusy(false);
    }
  }

  async function saveFee(event: FormEvent) {
    event.preventDefault(); setError(''); setNotice(''); setBusy(true);
    try {
      await adminSetFee(feeOperation, feeAsset, flatAmount, percentage);
      setNotice('Fee updated successfully.');
      void loadFees();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update fee.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <div className="hero">
        <span className="eyebrow">ADMIN · {role ?? 'UNKNOWN'} · RATES & FEES</span>
        <h1>Exchange Rates & Fees</h1>
        <p>Manage the platform exchange rate and fee configuration.</p>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="eyebrow" role="status">{notice}</p>}

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
        <button type="button" className="link-button" style={{ fontWeight: tab === 'rates' ? 700 : 400, color: tab === 'rates' ? '#fff' : undefined }} onClick={() => setTab('rates')}>Exchange Rate</button>
        <button type="button" className="link-button" style={{ fontWeight: tab === 'fees' ? 700 : 400, color: tab === 'fees' ? '#fff' : undefined }} onClick={() => setTab('fees')}>Fees</button>
      </div>

      {loading ? <p>Loading…</p> : (
        <>
          {tab === 'rates' && (
            <Card>
              <h2>USDT / PKR Exchange Rate</h2>
              {usdtRate && (
                <ul className="transaction-list">
                  <li><span>Current buy rate</span><span><strong>{usdtRate.buy_rate} PKR/USDT</strong></span></li>
                  <li><span>Current sell rate</span><span><strong>{usdtRate.sell_rate} PKR/USDT</strong></span></li>
                  <li><span>Version</span><span>{usdtRate.version}</span></li>
                  <li><span>Last updated</span><span>{formatTimestamp(usdtRate.created_at)}</span></li>
                </ul>
              )}
              {!usdtRate && <p>No active exchange rate configured.</p>}

              <form onSubmit={(event) => void saveRate(event)} style={{ marginTop: '1rem' }}>
                <label>Buy rate (PKR per 1 USDT — user pays this when buying USDT)
                  <input inputMode="decimal" value={buyRate} onChange={(event) => setBuyRate(event.target.value)} placeholder="e.g. 280.00" required />
                </label>
                <label>Sell rate (PKR per 1 USDT — user receives this when selling USDT)
                  <input inputMode="decimal" value={sellRate} onChange={(event) => setSellRate(event.target.value)} placeholder="e.g. 275.00" required />
                </label>
                <p><small>Buy rate should be higher than sell rate. The difference is the platform margin.</small></p>
                <button className="button" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Update exchange rate'}</button>
              </form>
            </Card>
          )}

          {tab === 'fees' && (
            <Card>
              <h2>Platform Fees</h2>
              {fees.length > 0 ? (
                <ul className="transaction-list">
                  {fees.map((fee) => (
                    <li key={fee.id}>
                      <span>{fee.operation} · {fee.asset_code}</span>
                      <span>{fee.flat_amount > 0 ? `${fee.flat_amount} flat` : ''} {fee.percentage > 0 ? `${fee.percentage}%` : fee.flat_amount === 0 ? 'Free' : ''}</span>
                      <small>{formatTimestamp(fee.created_at)}</small>
                    </li>
                  ))}
                </ul>
              ) : <p>No active fees configured. All operations are currently free.</p>}

              <form onSubmit={(event) => void saveFee(event)} style={{ marginTop: '1rem' }}>
                <label>Operation
                  <select value={feeOperation} onChange={(event) => setFeeOperation(event.target.value)}>
                    {operations.map((op) => <option key={op} value={op}>{op}</option>)}
                  </select>
                </label>
                <label>Asset
                  <select value={feeAsset} onChange={(event) => setFeeAsset(event.target.value)}>
                    {assets.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </label>
                <label>Flat fee amount
                  <input inputMode="decimal" value={flatAmount} onChange={(event) => setFlatAmount(event.target.value)} placeholder="0" />
                </label>
                <label>Percentage fee
                  <input inputMode="decimal" value={percentage} onChange={(event) => setPercentage(event.target.value)} placeholder="0" />
                  <small>0 = no percentage fee. Max 100%.</small>
                </label>
                <button className="button" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Update fee'}</button>
              </form>
            </Card>
          )}
        </>
      )}
    </main>
  );
}
