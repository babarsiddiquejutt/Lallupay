import { useCallback, useEffect, useState } from 'react';
import { Card, Button } from '../../components/ui';
import { getDeposits, getWithdrawals, confirmDeposit, rejectDeposit, approveWithdrawal, completeWithdrawal, rejectWithdrawal } from '../../lib/api/deposits';
import { formatTimestamp } from '../../lib/formatters';

type Tab = 'deposits' | 'withdrawals';

export function AdminDepositsWithdrawalsPage() {
  const [tab, setTab] = useState<Tab>('deposits');
  const [deposits, setDeposits] = useState<Record<string, unknown>[]>([]);
  const [withdrawals, setWithdrawals] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [withdrawalTxid, setWithdrawalTxid] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [d, w] = await Promise.all([getDeposits(), getWithdrawals()]);
      setDeposits(d);
      setWithdrawals(w);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load records.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleConfirmDeposit(id: string) {
    setBusy(id); setError(''); setNotice('');
    try {
      await confirmDeposit(id);
      setNotice('Deposit confirmed and credited.');
      void load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to confirm.');
    } finally {
      setBusy(null);
    }
  }

  async function handleRejectDeposit(id: string) {
    setBusy(id); setError(''); setNotice('');
    try {
      await rejectDeposit(id, rejectReason.trim() || undefined);
      setNotice('Deposit rejected.');
      setRejectReason(''); setExpandedId(null);
      void load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to reject.');
    } finally {
      setBusy(null);
    }
  }

  async function handleApproveWithdrawal(id: string) {
    setBusy(id); setError(''); setNotice('');
    try {
      await approveWithdrawal(id);
      setNotice('Withdrawal approved for processing.');
      void load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to approve.');
    } finally {
      setBusy(null);
    }
  }

  async function handleCompleteWithdrawal(id: string) {
    if (!withdrawalTxid.trim()) { setError('Enter the blockchain TXID.'); return; }
    setBusy(id); setError(''); setNotice('');
    try {
      await completeWithdrawal(id, withdrawalTxid.trim());
      setNotice('Withdrawal completed with TXID.');
      setWithdrawalTxid(''); setExpandedId(null);
      void load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to complete.');
    } finally {
      setBusy(null);
    }
  }

  async function handleRejectWithdrawal(id: string) {
    setBusy(id); setError(''); setNotice('');
    try {
      await rejectWithdrawal(id, rejectReason.trim() || undefined);
      setNotice('Withdrawal rejected and funds returned.');
      setRejectReason(''); setExpandedId(null);
      void load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to reject.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="page">
      <div className="hero">
        <span className="eyebrow">ADMIN · DEPOSITS & WITHDRAWALS</span>
        <h1>Deposits & Withdrawals</h1>
        <p>Review and manage user deposit and withdrawal requests.</p>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="eyebrow" role="status">{notice}</p>}

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
        <button type="button" className="link-button" style={{ fontWeight: tab === 'deposits' ? 700 : 400, color: tab === 'deposits' ? '#fff' : undefined }} onClick={() => setTab('deposits')}>Deposits ({deposits.filter((d) => d.status === 'pending').length} pending)</button>
        <button type="button" className="link-button" style={{ fontWeight: tab === 'withdrawals' ? 700 : 400, color: tab === 'withdrawals' ? '#fff' : undefined }} onClick={() => setTab('withdrawals')}>Withdrawals ({withdrawals.filter((w) => w.status === 'pending').length} pending)</button>
      </div>

      {loading ? <p>Loading…</p> : (
        <>
          {tab === 'deposits' && (
            <Card>
              <h2>Deposit Requests</h2>
              {deposits.length ? (
                <ul className="transaction-list">
                  {deposits.map((d) => (
                    <li key={String(d.id)}>
                      <span>
                        <strong>{String(d.amount)} USDT</strong>
                        <br />
                        <small style={{ color: '#c5c8dc' }}>User {String(d.user_id).slice(0, 8)}… · TXID: {String(d.txid).slice(0, 16)}…</small>
                      </span>
                      <span className={`status ${String(d.status) === 'confirmed' ? 'completed' : String(d.status) === 'rejected' ? 'cancelled' : 'pending'}`}>{String(d.status)}</span>
                      <span style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                        {String(d.status) === 'pending' && (
                          <>
                            <Button onClick={() => void handleConfirmDeposit(String(d.id))} disabled={busy === String(d.id)}>Confirm</Button>
                            <Button className="secondary" onClick={() => { setExpandedId(expandedId === String(d.id) ? null : String(d.id)); }} disabled={busy === String(d.id)}>Reject</Button>
                          </>
                        )}
                        <small>{formatTimestamp(String(d.created_at))}</small>
                      </span>
                      {expandedId === String(d.id) && String(d.status) === 'pending' && (
                        <div style={{ gridColumn: '1 / -1', marginTop: '.5rem' }}>
                          <label>Rejection reason
                            <input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Why is this deposit rejected?" />
                          </label>
                          <Button className="secondary" onClick={() => void handleRejectDeposit(String(d.id))} disabled={busy === String(d.id)}>Confirm rejection</Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              ) : <p>No deposits yet.</p>}
            </Card>
          )}

          {tab === 'withdrawals' && (
            <Card>
              <h2>Withdrawal Requests</h2>
              {withdrawals.length ? (
                <ul className="transaction-list">
                  {withdrawals.map((w) => (
                    <li key={String(w.id)}>
                      <span>
                        <strong>{String(w.amount)} USDT</strong>
                        <br />
                        <small style={{ color: '#c5c8dc' }}>User {String(w.user_id).slice(0, 8)}… · {String(w.address).slice(0, 16)}…</small>
                      </span>
                      <span className={`status ${String(w.status) === 'completed' ? 'completed' : String(w.status) === 'failed' ? 'cancelled' : 'pending'}`}>{String(w.status)}</span>
                      <span style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                        {String(w.status) === 'pending' && (
                          <Button onClick={() => void handleApproveWithdrawal(String(w.id))} disabled={busy === String(w.id)}>Approve</Button>
                        )}
                        {String(w.status) === 'processing' && (
                          <Button onClick={() => { setExpandedId(expandedId === String(w.id) ? null : String(w.id)); }} disabled={busy === String(w.id)}>Complete</Button>
                        )}
                        {(String(w.status) === 'pending' || String(w.status) === 'processing') && (
                          <Button className="secondary" onClick={() => { setExpandedId(expandedId === String(w.id) ? 'reject-' + String(w.id) : null); }} disabled={busy === String(w.id)}>Reject</Button>
                        )}
                        <small>{formatTimestamp(String(w.created_at))}</small>
                      </span>
                      {expandedId === String(w.id) && String(w.status) === 'processing' && (
                        <div style={{ gridColumn: '1 / -1', marginTop: '.5rem' }}>
                          <label>Blockchain TXID
                            <input value={withdrawalTxid} onChange={(e) => setWithdrawalTxid(e.target.value)} placeholder="Enter the TRC20 TXID" />
                          </label>
                          <Button onClick={() => void handleCompleteWithdrawal(String(w.id))} disabled={busy === String(w.id)}>Complete withdrawal</Button>
                        </div>
                      )}
                      {expandedId === 'reject-' + String(w.id) && (
                        <div style={{ gridColumn: '1 / -1', marginTop: '.5rem' }}>
                          <label>Rejection reason
                            <input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Why is this withdrawal rejected?" />
                          </label>
                          <Button className="secondary" onClick={() => void handleRejectWithdrawal(String(w.id))} disabled={busy === String(w.id)}>Confirm rejection</Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              ) : <p>No withdrawals yet.</p>}
            </Card>
          )}
        </>
      )}
    </main>
  );
}
