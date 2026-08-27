import { useCallback, useEffect, useState } from 'react';
import { Card, EmptyState, Button } from '../../components/ui';
import { getAllDisputes } from '../../lib/db/admin';
import { adminResolveDispute } from '../../lib/api/admin';
import { formatTimestamp } from '../../lib/formatters';
import type { P2pDispute } from '../../types/database';

export function AdminDisputesPage() {
  const [disputes, setDisputes] = useState<P2pDispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [resolution, setResolution] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setDisputes(await getAllDisputes()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load disputes.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function resolve(id: string, outcome: 'release_to_buyer' | 'refund_to_seller') {
    if (resolution.trim().length < 5) { setError('Resolution note must be at least 5 characters.'); return; }
    setBusy(id); setError(''); setNotice('');
    try {
      await adminResolveDispute(id, outcome, resolution.trim());
      setNotice(`Dispute resolved: ${outcome.replace(/_/g, ' ')}.`);
      setResolution(''); setExpandedId(null);
      void load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to resolve dispute.'); }
    finally { setBusy(null); }
  }

  const filtered = filter ? disputes.filter((d) => d.status === filter) : disputes;

  return (
    <main className="page">
      <div className="hero">
        <span className="eyebrow">ADMIN · DISPUTES</span>
        <h1>Dispute Management</h1>
        <p>Review and resolve P2P payment disputes.</p>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="eyebrow" role="status">{notice}</p>}

      <Card>
        <div className="section-heading"><h2>Disputes</h2><span>{disputes.length} total</span></div>
        <label>Filter
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">All</option>
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
        {loading ? <p>Loading…</p> : (
          filtered.length ? filtered.map((d) => (
            <Card key={d.id}>
              <div className="section-heading">
                <h2>Dispute on order {d.order_id.slice(0, 8)}…</h2>
                <span className={`status ${d.status === 'resolved' ? 'completed' : d.status === 'open' ? 'pending' : 'cancelled'}`}>{d.status}</span>
              </div>
              <ul className="transaction-list">
                <li><span>Opened by</span><span>{d.opened_by.slice(0, 8)}…</span></li>
                <li><span>Reason</span><span>{d.reason}</span></li>
                <li><span>Opened at</span><span>{formatTimestamp(d.created_at)}</span></li>
                {d.resolution && <li><span>Resolution</span><span>{d.resolution}</span></li>}
                {d.resolved_at && <li><span>Resolved at</span><span>{formatTimestamp(d.resolved_at)}</span></li>}
              </ul>
              {d.status === 'open' && (
                <>
                  {expandedId === d.id ? (
                    <div style={{ marginTop: '1rem' }}>
                      <label>Resolution note
                        <input value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="Describe the resolution" />
                      </label>
                      <div className="section-heading" style={{ gap: '1rem' }}>
                        <Button onClick={() => void resolve(d.id, 'release_to_buyer')} disabled={busy === d.id}>{busy === d.id ? 'Resolving…' : 'Release USDT to buyer'}</Button>
                        <Button className="secondary" onClick={() => void resolve(d.id, 'refund_to_seller')} disabled={busy === d.id}>{busy === d.id ? 'Resolving…' : 'Refund USDT to seller'}</Button>
                      </div>
                      <button type="button" className="link-button" onClick={() => { setExpandedId(null); setResolution(''); }}>Cancel</button>
                    </div>
                  ) : (
                    <Button onClick={() => setExpandedId(d.id)}>Resolve dispute</Button>
                  )}
                </>
              )}
            </Card>
          )) : <EmptyState title="No disputes" body="No disputes match the current filter." />
        )}
      </Card>
    </main>
  );
}
