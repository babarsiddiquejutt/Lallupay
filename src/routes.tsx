import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AuthPage } from './pages/AuthPage';
import { DashboardPage } from './pages/DashboardPage';
import { ProfilePage } from './pages/ProfilePage';
import { WalletPage } from './pages/WalletPage';
import { ConvertPage } from './pages/ConvertPage';
import { TransferPage } from './pages/TransferPage';
import { P2PPage } from './pages/P2PPage';
import { useAuth } from './hooks/useAuth';

function ProtectedRoute() { const { user, loading } = useAuth(); const location = useLocation(); if (loading) return <main className="center-page">Loading secure session…</main>; return user ? <Outlet /> : <Navigate to="/auth" state={{ from: location.pathname }} replace />; }

export function AppRoutes() { return <Routes><Route path="/auth" element={<AuthPage />} /><Route element={<ProtectedRoute />}><Route path="/dashboard" element={<DashboardPage />} /><Route path="/wallet" element={<WalletPage />} /><Route path="/convert" element={<ConvertPage />} /><Route path="/transfer" element={<TransferPage />} /><Route path="/p2p" element={<P2PPage />} /><Route path="/profile" element={<ProfilePage />} /></Route><Route path="*" element={<Navigate to="/dashboard" replace />} /></Routes>; }
