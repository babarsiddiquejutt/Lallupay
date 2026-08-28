import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, EmptyState } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { getWallets } from '../lib/db/wallets';
import { getTransactions } from '../lib/db/transactions';
import { getNotifications, markNotificationRead } from '../lib/db/notifications';
import { formatTimestamp } from '../lib/formatters';
import { subscribeToTable } from '../lib/realtime';
import type { Notification, Transaction, Wallet } from '../types/database';

export function DashboardPage() {
  const { user } = useAuth();
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return undefined;
    const load = async () => {
      try {
        const [nextWallets, nextTransactions, nextNotifications] = await Promise.all([
          getWallets(user.id),
          getTransactions(user.id),
          getNotifications(user.id),
        ]);
        setWallets(nextWallets);
        setTransactions(nextTransactions);
        setNotifications(nextNotifications);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Unable to load your wallet.');
      }
    };
    void load();
    const unsubTransactions = subscribeToTable('transactions', `user_id=eq.${user.id}`, () => { void load(); });
    const unsubNotifications = subscribeToTable('notifications', `user_id=eq.${user.id}`, () => { void load(); });
    return () => { unsubTransactions(); unsubNotifications(); };
  }, [user]);

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  function handleNotificationClick(notification: Notification) {
    if (!notification.read_at) {
      void markNotificationRead(notification.id).then(() => {
        setNotifications((prev) => prev.map((n) => n.id === notification.id ? { ...n, read_at: new Date().toISOString() } : n));
      });
    }
  }

  return (
    <main className="page">
      <div className="hero">
        <span className="eyebrow">LALLUPAY</span>
        <h1>Your financial home</h1>
        <p>Balances and transactions update in real time.</p>
      </div>
      {error && <p className="error">{error}</p>}

      <section className="wallet-grid">
        {wallets.length ? wallets.map((wallet) => (
          <Card key={wallet.id}>
            <span>{wallet.asset_code} wallet</span>
            <strong>{Number(wallet.balance_snapshot).toLocaleString(undefined, { maximumFractionDigits: wallet.asset_code === 'USDT' ? 8 : 2 })} {wallet.asset_code}</strong>
            <Link to="/wallet">View wallet →</Link>
          </Card>
        )) : <EmptyState title="No wallets yet" body="Wallets are created after account verification." />}
      </section>

      <section className="card">
        <div className="section-heading">
          <h2>Recent activity</h2>
          <Link to="/wallet">All transactions</Link>
        </div>
        {transactions.length ? (
          <ul className="transaction-list">
            {transactions.map((transaction) => (
              <li key={transaction.id}>
                <span>{transaction.type}</span>
                <span>{transaction.net_amount} {transaction.asset_code}</span>
                <span className={`status ${transaction.status}`}>{transaction.status}</span>
              </li>
            ))}
          </ul>
        ) : <EmptyState title="No activity yet" body="Your verified financial activity will appear here." />}
      </section>

      {notifications.length > 0 && (
        <section className="card">
          <div className="section-heading">
            <h2>Notifications</h2>
            {unreadCount > 0 && <span>{unreadCount} unread</span>}
          </div>
          <ul className="transaction-list">
            {notifications.slice(0, 5).map((n) => (
              <li
                key={n.id}
                style={{ cursor: n.read_at ? undefined : 'pointer', opacity: n.read_at ? 0.6 : 1 }}
                onClick={() => handleNotificationClick(n)}
              >
                <span style={{ fontWeight: n.read_at ? 400 : 700 }}>{n.title}</span>
                <span>{n.body}</span>
                <span>{formatTimestamp(n.created_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
