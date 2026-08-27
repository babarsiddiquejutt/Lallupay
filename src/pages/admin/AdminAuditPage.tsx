import { useCallback, useEffect, useState } from 'react';
import { Card, EmptyState, Button } from '../../components/ui';
import { getAuditLogs } from '../../lib/db/admin';
import { formatTimestamp } from '../../lib/formatters';

export function AdminAuditPage() {
  const [logs, setLogs] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const result = await getAuditLogs(page);
      setLogs(result.items);
      setTotal(result.total);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load audit logs.'); }
    finally { setLoading(false); }
  }, [page]);

  useEffect(() => { void load(); }, [load]);

  const filtered = filter ? logs.filter((l) => String(l.action).includes(filter) || String(l.entity_type).includes(filter)) : logs;

  return (
    <main className="page">
      <div className="hero">
        <span className="eyebrow">ADMIN · AUDIT</span>
        <h1>Audit Logs</h1>
        <p>System-wide audit trail of all privileged actions.</p>
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      <Card>
        <div className="section-heading"><h2>Audit logs</h2><span>{total} records</span></div>
        <label>Filter
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by action or entity type" />
        </label>
        {loading ? <p>Loading…</p> : (
          <>
            {filtered.length ? (
              <ul className="transaction-list">
                {filtered.map((l) => (
                  <li key={String(l.id)}>
                    <span>
                      <strong>{String(l.action)}</strong>
                      <br />
                      <small style={{ color: '#c5c8dc' }}>Entity: {String(l.entity_type)} · {String(l.entity_id ?? '').slice(0, 8)}</small>
                    </span>
                    <span style={{ fontSize: '.8rem', wordBreak: 'break-all' }}>Actor {String(l.actor_id ?? '').slice(0, 8)}…</span>
                    <span>{formatTimestamp(String(l.created_at))}</span>
                  </li>
                ))}
              </ul>
            ) : <EmptyState title="No audit logs" body="No audit logs match the current filter." />}
            <div className="section-heading" style={{ marginTop: '1rem', gap: '1rem' }}>
              <Button className="secondary" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Previous</Button>
              <small>Page {page + 1} of {Math.ceil(total / 50) || 1}</small>
              <Button className="secondary" disabled={(page + 1) * 50 >= total} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </>
        )}
      </Card>
    </main>
  );
}
