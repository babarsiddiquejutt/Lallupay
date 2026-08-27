import { useCallback, useEffect, useState } from 'react';
import { Card, EmptyState, Button } from '../../components/ui';
import { searchProfiles, getKycSubmissions } from '../../lib/db/admin';
import { adminUpdateKyc } from '../../lib/api/admin';
import { formatTimestamp } from '../../lib/formatters';
import type { Profile } from '../../types/database';

export function AdminKycPage() {
  const [submissions, setSubmissions] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [view, setView] = useState<'submissions' | 'lookup'>('submissions');

  const loadSubmissions = useCallback(async () => {
    setLoading(true);
    try { setSubmissions(await getKycSubmissions()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load KYC submissions.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadSubmissions(); }, [loadSubmissions]);

  async function handleApprove(userId: string) {
    setBusy(userId); setError(''); setNotice('');
    try {
      await adminUpdateKyc(userId, 'approved');
      setNotice('User KYC approved.');
      void loadSubmissions();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to approve KYC.'); }
    finally { setBusy(null); }
  }

  async function handleReject(userId: string) {
    if (rejectionReason.trim().length < 5) { setError('Enter a rejection reason of at least 5 characters.'); return; }
    setBusy(userId); setError(''); setNotice('');
    try {
      await adminUpdateKyc(userId, 'rejected', rejectionReason.trim());
      setNotice('User KYC rejected.');
      setRejectionReason('');
      void loadSubmissions();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to reject KYC.'); }
    finally { setBusy(null); }
  }

  async function searchUser() {
    if (!searchQuery.trim()) return;
    setLoading(true); setError('');
    try { setSearchResults(await searchProfiles(searchQuery)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Search failed.'); }
    finally { setLoading(false); }
  }

  const pendingSubmissions = submissions.filter((s) => s.status === 'pending');

  return (
    <main className="page">
      <div className="hero">
        <span className="eyebrow">ADMIN · KYC</span>
        <h1>KYC Review</h1>
        <p>Review and manage user identity verification.</p>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="eyebrow" role="status">{notice}</p>}

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
        <button type="button" className="link-button" style={{ fontWeight: view === 'submissions' ? 700 : 400, color: view === 'submissions' ? '#fff' : undefined }} onClick={() => setView('submissions')}>Submissions ({pendingSubmissions.length} pending)</button>
        <button type="button" className="link-button" style={{ fontWeight: view === 'lookup' ? 700 : 400, color: view === 'lookup' ? '#fff' : undefined }} onClick={() => setView('lookup')}>User lookup</button>
      </div>

      {view === 'lookup' && (
        <Card>
          <form onSubmit={(e) => { e.preventDefault(); void searchUser(); }}>
            <label>Search user
              <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Username, name, or mobile" />
            </label>
            <Button type="submit">Search</Button>
          </form>
          {searchResults.length > 0 && (
            <>
              <h2>Results</h2>
              <ul className="transaction-list">
                {searchResults.map((u) => (
                  <li key={u.id}>
                    <span>{u.username ? `@${u.username}` : u.full_name || u.id.slice(0, 8)}</span>
                    <span>KYC: {u.kyc_status}</span>
                    <span style={{ display: 'flex', gap: '.5rem' }}>
                      {u.kyc_status !== 'approved' && <Button onClick={() => void handleApprove(u.id)} disabled={busy === u.id}>Approve</Button>}
                      {u.kyc_status !== 'rejected' && <Button className="secondary" onClick={() => void handleReject(u.id)} disabled={busy === u.id}>Reject</Button>}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}

      {view === 'submissions' && (
        <Card>
          {loading ? <p>Loading submissions…</p> : (
            <>
              <div className="section-heading"><h2>KYC submissions</h2><span>{submissions.length} total</span></div>
              {submissions.length ? (
                <ul className="transaction-list">
                  {submissions.map((s) => (
                    <li key={String(s.id)}>
                      <span>User {String(s.user_id).slice(0, 8)}…</span>
                      <span className={`status ${String(s.status) === 'approved' ? 'completed' : String(s.status) === 'rejected' ? 'cancelled' : 'pending'}`}>{String(s.status)}</span>
                      <span style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                        {String(s.status) === 'pending' && (
                          <>
                            <Button onClick={() => void handleApprove(String(s.user_id))} disabled={busy === String(s.user_id)}>Approve</Button>
                            <Button className="secondary" onClick={() => void handleReject(String(s.user_id))} disabled={busy === String(s.user_id)}>Reject</Button>
                          </>
                        )}
                        <small>{formatTimestamp(String(s.created_at))}</small>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : <EmptyState title="No KYC submissions" body="User KYC submissions will appear here." />}

              {pendingSubmissions.length > 0 && (
                <div style={{ marginTop: '1rem' }}>
                  <label>Rejection reason (for rejecting users above)
                    <input value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} placeholder="Describe why KYC is rejected" />
                  </label>
                </div>
              )}
            </>
          )}
        </Card>
      )}
    </main>
  );
}
