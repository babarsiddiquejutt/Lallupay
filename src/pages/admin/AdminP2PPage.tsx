import { useCallback, useEffect, useState } from 'react';
import { Card, EmptyState, Button } from '../../components/ui';
import { getAllP2pOrders } from '../../lib/db/admin';
import { formatAssetAmount } from '../../lib/formatters';
import type { P2pOrder, P2pOrderStatus } from '../../types/database';

const statusLabels: Record<P2pOrderStatus, string> = {
  created: 'Awaiting payment', payment_sent: 'Payment sent', completed: 'Completed',
  cancelled: 'Cancelled', expired: 'Expired', disputed: 'Disputed',
};

export function AdminP2PPage() {
  const [orders, setOrders] = useState<P2pOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const result = await getAllP2pOrders(page);
      setOrders(result.items);
      setTotal(result.total);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load P2P orders.'); }
    finally { setLoading(false); }
  }, [page]);

  useEffect(() => { void load(); }, [load]);

  const filtered = statusFilter ? orders.filter((o) => o.status === statusFilter) : orders;

  return (
    <main className="page">
      <div className="hero">
        <span className="eyebrow">ADMIN · P2P</span>
        <h1>P2P Marketplace Monitor</h1>
        <p>Monitor all P2P orders and marketplace activity.</p>
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      <Card>
        <div className="section-heading"><h2>Orders</h2><span>{total} total</span></div>
        <label>Filter by status
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="created">Created</option>
            <option value="payment_sent">Payment sent</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
            <option value="expired">Expired</option>
            <option value="disputed">Disputed</option>
          </select>
        </label>
        {loading ? <p>Loading…</p> : (
          <>
            {filtered.length ? (
              <ul className="transaction-list">
                {filtered.map((o) => (
                  <li key={o.id}>
                    <span>
                      <strong>{formatAssetAmount(o.crypto_amount ?? '0', 'USDT')}</strong> for {formatAssetAmount(o.amount, 'PKR')}
                      <br />
                      <small style={{ color: '#c5c8dc' }}>Buyer {o.buyer_id.slice(0, 8)}… · Seller {o.seller_id.slice(0, 8)}…</small>
                    </span>
                    <span>{o.price ? `${o.price} PKR/USDT` : '—'}</span>
                    <span className={`status ${o.status === 'completed' ? 'completed' : o.status === 'disputed' ? 'review' : o.status === 'cancelled' || o.status === 'expired' ? 'cancelled' : 'pending'}`}>{statusLabels[o.status]}</span>
                  </li>
                ))}
              </ul>
            ) : <EmptyState title="No orders" body="No P2P orders match the current filter." />}
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
