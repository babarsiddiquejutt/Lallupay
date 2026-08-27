import { useCallback, useEffect, useState } from 'react';
import { Card, EmptyState, Button } from '../../components/ui';
import { getAllTransactions } from '../../lib/db/admin';
import { formatAssetAmount } from '../../lib/formatters';
import type { Transaction } from '../../types/database';

export function AdminTransactionsPage() {
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const result = await getAllTransactions(page);
      setTxns(result.items);
      setTotal(result.total);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load transactions.'); }
    finally { setLoading(false); }
  }, [page]);

  useEffect(() => { void load(); }, [load]);

  const filtered = filter ? txns.filter((t) => t.type.includes(filter) || t.status.includes(filter) || t.asset_code.includes(filter)) : txns;

  return (
    <main className="page">
      <div className="hero">
        <span className="eyebrow">ADMIN · TRANSACTIONS</span>
        <h1>Transaction Monitoring</h1>
        <p>Monitor all platform transactions across the ledger.</p>
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      <Card>
        <div className="section-heading"><h2>All transactions</h2><span>{total} records</span></div>
        <label>Filter
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by type, status, or asset" />
        </label>
        {loading ? <p>Loading…</p> : (
          <>
            {filtered.length ? (
              <ul className="transaction-list">
                {filtered.map((t) => (
                  <li key={t.id}>
                    <span>
                      <strong>{t.type}</strong>
                      <br />
                      <small style={{ color: '#c5c8dc' }}>User {t.user_id.slice(0, 8)}… · {t.reference}</small>
                    </span>
                    <span>{formatAssetAmount(t.net_amount, t.asset_code)}</span>
                    <span className={`status ${t.status}`}>{t.status}</span>
                  </li>
                ))}
              </ul>
            ) : <EmptyState title="No transactions" body="No transactions match the current filter." />}
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
