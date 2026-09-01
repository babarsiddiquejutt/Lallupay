import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, EmptyState } from '../../components/ui';
import { useAdmin } from '../../hooks/useAdmin';
import { adminGetStats, type AdminStats } from '../../lib/api/admin';
import { getAllTransactions } from '../../lib/db/admin';
import { formatAssetAmount } from '../../lib/formatters';
import type { Transaction } from '../../types/database';

export function AdminDashboardPage() {
  const { role } = useAdmin();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [recentTxns, setRecentTxns] = useState<Transaction[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [statsResult, txnResult] = await Promise.all([adminGetStats(), getAllTransactions(0, 10)]);
      setStats(statsResult);
      setRecentTxns(txnResult.items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load admin data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <main className="page"><p>Loading admin dashboard…</p></main>;

  return (
    <main className="page">
      <div className="hero">
        <span className="eyebrow">ADMIN · {role ?? 'UNKNOWN'}</span>
        <h1>Admin Dashboard</h1>
        <p>Platform overview and management.</p>
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      <section className="wallet-grid">
        <Card>
          <span>Total users</span>
          <strong>{stats?.totalUsers ?? 0}</strong>
          <Link to="/admin/users">Manage users →</Link>
        </Card>
        <Card>
          <span>Transactions</span>
          <strong>{stats?.totalTransactions ?? 0}</strong>
          <Link to="/admin/transactions">View all →</Link>
        </Card>
        <Card>
          <span>P2P orders</span>
          <strong>{stats?.totalOrders ?? 0}</strong>
          <Link to="/admin/p2p">Monitor →</Link>
        </Card>
        <Card>
          <span>Open disputes</span>
          <strong style={{ color: (stats?.openDisputes ?? 0) > 0 ? '#fca5a5' : undefined }}>{stats?.openDisputes ?? 0}</strong>
          <Link to="/admin/disputes">Resolve →</Link>
        </Card>
      </section>

      <section className="card">
        <div className="section-heading"><h2>Quick actions</h2></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
          <Link to="/admin/kyc" className="button" style={{ textAlign: 'center', textDecoration: 'none' }}>KYC Review</Link>
          <Link to="/admin/disputes" className="button" style={{ textAlign: 'center', textDecoration: 'none' }}>Disputes</Link>
          <Link to="/admin/rates" className="button secondary" style={{ textAlign: 'center', textDecoration: 'none' }}>Rates & Fees</Link>
          <Link to="/admin/users" className="button secondary" style={{ textAlign: 'center', textDecoration: 'none' }}>User Search</Link>
          <Link to="/admin/audit" className="button secondary" style={{ textAlign: 'center', textDecoration: 'none' }}>Audit Logs</Link>
        </div>
      </section>

      <section className="card">
        <div className="section-heading"><h2>Recent transactions</h2><Link to="/admin/transactions">View all</Link></div>
        {recentTxns.length ? (
          <ul className="transaction-list">
            {recentTxns.map((t) => (
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
        ) : <EmptyState title="No transactions" body="Transactions will appear here once users start transacting." />}
      </section>
    </main>
  );
}
