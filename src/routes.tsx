import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AuthPage } from './pages/AuthPage';
import { DashboardPage } from './pages/DashboardPage';
import { ProfilePage } from './pages/ProfilePage';
import { WalletPage } from './pages/WalletPage';
import { ConvertPage } from './pages/ConvertPage';
import { TransferPage } from './pages/TransferPage';
import { KycPage } from './pages/KycPage';
import { P2PPage } from './pages/P2PPage';
import { useAuth } from './hooks/useAuth';
import { useAdmin } from './hooks/useAdmin';

// Admin pages
import { AdminDashboardPage } from './pages/admin/AdminDashboardPage';
import { AdminUsersPage } from './pages/admin/AdminUsersPage';
import { AdminKycPage } from './pages/admin/AdminKycPage';
import { AdminTransactionsPage } from './pages/admin/AdminTransactionsPage';
import { AdminP2PPage } from './pages/admin/AdminP2PPage';
import { AdminDisputesPage } from './pages/admin/AdminDisputesPage';
import { AdminAuditPage } from './pages/admin/AdminAuditPage';
import { AdminRatesPage } from './pages/admin/AdminRatesPage';
import { AdminDepositsWithdrawalsPage } from './pages/admin/AdminDepositsWithdrawalsPage';
import { DepositPage } from './pages/DepositPage';
import { WithdrawPage } from './pages/WithdrawPage';

function ProtectedRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <main className="center-page">Loading secure session…</main>;
  return user ? <Outlet /> : <Navigate to="/auth" state={{ from: location.pathname }} replace />;
}

function AdminRoute() {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, loading: adminLoading } = useAdmin();
  const location = useLocation();
  if (authLoading || adminLoading) return <main className="center-page">Checking admin access…</main>;
  if (!user) return <Navigate to="/auth" state={{ from: location.pathname }} replace />;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/auth" element={<AuthPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/wallet" element={<WalletPage />} />
        <Route path="/convert" element={<ConvertPage />} />
        <Route path="/transfer" element={<TransferPage />} />
        <Route path="/p2p" element={<P2PPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/kyc" element={<KycPage />} />
        <Route path="/deposit" element={<DepositPage />} />
        <Route path="/withdraw" element={<WithdrawPage />} />
        {/* Admin routes */}
        <Route element={<AdminRoute />}>
          <Route path="/admin" element={<AdminDashboardPage />} />
          <Route path="/admin/users" element={<AdminUsersPage />} />
          <Route path="/admin/kyc" element={<AdminKycPage />} />
          <Route path="/admin/transactions" element={<AdminTransactionsPage />} />
          <Route path="/admin/p2p" element={<AdminP2PPage />} />
          <Route path="/admin/disputes" element={<AdminDisputesPage />} />
          <Route path="/admin/audit" element={<AdminAuditPage />} />
          <Route path="/admin/rates" element={<AdminRatesPage />} />
          <Route path="/admin/deposits" element={<AdminDepositsWithdrawalsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
