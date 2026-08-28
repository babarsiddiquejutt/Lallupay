import { useCallback, useEffect, useState } from 'react';
import { Card, EmptyState } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { getTransactionsPage } from '../lib/db/transactions';
import { getWallets } from '../lib/db/wallets';
import { formatAssetAmount, formatTimestamp } from '../lib/formatters';
import { subscribeToTable } from '../lib/realtime';
import type { Transaction, Wallet } from '../types/database';

const transactionPageSize = 20;

/** Displays the authenticated user's read-only, ledger-derived wallet data. */
export function WalletPage() {
  const { user } = useAuth();
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [transactionTotal, setTransactionTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setError('');
      const [nextWallets, transactionPage] = await Promise.all([getWallets(user.id), getTransactionsPage(user.id, 0, transactionPageSize)]);
      setWallets(nextWallets);
      setTransactions(transactionPage.items);
      setTransactionTotal(transactionPage.total);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load wallet data.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
    if (!user) return undefined;
    const unsubscribeTransactions = subscribeToTable('transactions', `user_id=eq.${user.id}`, () => { void load(); });
    const unsubscribeWallets = subscribeToTable('wallets', `user_id=eq.${user.id}`, () => { void load(); });
    return () => { unsubscribeTransactions(); unsubscribeWallets(); };
  }, [load, user]);

  if (loading) return <main className="page"><p>Loading wallet…</p></main>;
  return <main className="page"><div className="hero"><span className="eyebrow">LALLUPAY</span><h1>Wallet activity</h1><p>Balances are derived from the server-side ledger and update in real time.</p></div>{error && <p className="error">{error}</p>}<section className="wallet-grid">{wallets.length ? wallets.map((wallet) => <Card key={wallet.id}><span>{wallet.asset_code} balance</span><strong>{formatAssetAmount(wallet.balance_snapshot, wallet.asset_code)}</strong><small>Updated {formatTimestamp(wallet.updated_at)}</small></Card>) : <EmptyState title="No wallets available" body="Wallets are automatically created after your account is provisioned." />}</section><section className="card"><div className="section-heading"><h2>Transaction history</h2><span>{transactionTotal} records</span></div>{transactions.length ? <ul className="transaction-list">{transactions.map((transaction) => <li key={transaction.id}><span>{transaction.type}</span><span>{formatAssetAmount(transaction.net_amount, transaction.asset_code)}</span><span className={`status ${transaction.status}`}>{transaction.status}</span></li>)}</ul> : <EmptyState title="No transactions yet" body="Completed deposits, transfers, conversions, and withdrawals will appear here." />}</section></main>;
}
