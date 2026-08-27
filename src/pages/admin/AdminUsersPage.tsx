import { useCallback, useEffect, useState } from 'react';
import { Card, EmptyState, Button } from '../../components/ui';
import { searchProfiles, getAllProfiles, getUserWallets, getTransactionsForUser } from '../../lib/db/admin';
import { formatTimestamp } from '../../lib/formatters';
import type { Profile, Wallet, Transaction } from '../../types/database';

export function AdminUsersPage() {
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<Profile[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedUser, setSelectedUser] = useState<Profile | null>(null);
  const [userWallets, setUserWallets] = useState<Wallet[]>([]);
  const [userTxns, setUserTxns] = useState<Transaction[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (query.trim()) {
        const results = await searchProfiles(query);
        setUsers(results);
        setTotal(results.length);
      } else {
        const result = await getAllProfiles(page);
        setUsers(result.items);
        setTotal(result.total);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load users.');
    } finally {
      setLoading(false);
    }
  }, [query, page]);

  useEffect(() => { void load(); }, [load]);

  async function viewUser(user: Profile) {
    setSelectedUser(user);
    setError('');
    try {
      const [wallets, txns] = await Promise.all([getUserWallets(user.id), getTransactionsForUser(user.id, 0, 20)]);
      setUserWallets(wallets);
      setUserTxns(txns.items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load user details.');
    }
  }

  return (
    <main className="page">
      <div className="hero">
        <span className="eyebrow">ADMIN · USERS</span>
        <h1>User Management</h1>
        <p>Search and inspect user accounts.</p>
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      {selectedUser ? (
        <>
          <button type="button" className="link-button" onClick={() => { setSelectedUser(null); setUserWallets([]); setUserTxns([]); }}>← Back to user list</button>
          <Card>
            <div className="section-heading"><h2>{selectedUser.full_name || selectedUser.username || selectedUser.id.slice(0, 8)}</h2><span className={`status ${selectedUser.kyc_status === 'approved' ? 'completed' : 'pending'}`}>{selectedUser.kyc_status}</span></div>
            <ul className="transaction-list">
              <li><span>User ID</span><span style={{ fontSize: '.8rem', wordBreak: 'break-all' }}>{selectedUser.id}</span></li>
              <li><span>Username</span><span>{selectedUser.username ? `@${selectedUser.username}` : '—'}</span></li>
              <li><span>Full name</span><span>{selectedUser.full_name || '—'}</span></li>
              <li><span>Mobile</span><span>{selectedUser.mobile || '—'}</span></li>
              <li><span>KYC tier</span><span>{selectedUser.kyc_tier}</span></li>
              <li><span>Joined</span><span>{formatTimestamp(selectedUser.created_at)}</span></li>
            </ul>
          </Card>

          <Card>
            <h2>Wallets</h2>
            {userWallets.length ? (
              <ul className="transaction-list">
                {userWallets.map((w) => (
                  <li key={w.id}><span>{w.asset_code}</span><span><strong>{Number(w.balance_snapshot).toLocaleString(undefined, { maximumFractionDigits: w.asset_code === 'USDT' ? 8 : 2 })}</strong></span><span>{formatTimestamp(w.updated_at)}</span></li>
                ))}
              </ul>
            ) : <EmptyState title="No wallets" body="This user has no wallets." />}
          </Card>

          <Card>
            <div className="section-heading"><h2>Recent transactions</h2><span>{userTxns.length}</span></div>
            {userTxns.length ? (
              <ul className="transaction-list">
                {userTxns.map((t) => (
                  <li key={t.id}><span>{t.type} · {t.asset_code}</span><span>{t.net_amount}</span><span className={`status ${t.status}`}>{t.status}</span></li>
                ))}
              </ul>
            ) : <EmptyState title="No transactions" body="No transactions found for this user." />}
          </Card>
        </>
      ) : (
        <Card>
          <form onSubmit={(e) => { e.preventDefault(); setPage(0); void load(); }}>
            <label>Search users
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Username, name, or mobile" />
            </label>
            <Button type="submit">Search</Button>
          </form>

          {loading ? <p>Loading…</p> : (
            <>
              <div className="section-heading" style={{ marginTop: '1rem' }}><h2>Users</h2><span>{total} total</span></div>
              {users.length ? (
                <ul className="transaction-list">
                  {users.map((u) => (
                    <li key={u.id} style={{ cursor: 'pointer' }} onClick={() => void viewUser(u)}>
                      <span>{u.username ? `@${u.username}` : u.full_name || u.id.slice(0, 8)}</span>
                      <span>{u.full_name || '—'}</span>
                      <span className={`status ${u.kyc_status === 'approved' ? 'completed' : 'pending'}`}>{u.kyc_status}</span>
                    </li>
                  ))}
                </ul>
              ) : <EmptyState title="No users found" body="Try a different search term." />}
              {!query && (
                <div className="section-heading" style={{ marginTop: '1rem', gap: '1rem' }}>
                  <Button className="secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                  <small>Page {page + 1}</small>
                  <Button className="secondary" disabled={users.length < 50} onClick={() => setPage((p) => p + 1)}>Next</Button>
                </div>
              )}
            </>
          )}
        </Card>
      )}
    </main>
  );
}
