import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AuthPage } from './pages/AuthPage';
import { DashboardPage } from './pages/DashboardPage';
import { ComingSoonPage } from './pages/ComingSoonPage';
import { WalletPage } from './pages/WalletPage';
import { useAuth } from './hooks/useAuth';

function ProtectedRoute() { const { user, loading } = useAuth(); const location = useLocation(); if (loading) return <main className="center-page">Loading secure session…</main>; return user ? <Outlet /> : <Navigate to="/auth" state={{ from: location.pathname }} replace />; }

export function AppRoutes() { return <Routes><Route path="/auth" element={<AuthPage />} /><Route element={<ProtectedRoute />}><Route path="/dashboard" element={<DashboardPage />} /><Route path="/wallet" element={<WalletPage />} /><Route path="/convert" element={<ComingSoonPage title="Convert PKR ↔ USDT" />} /><Route path="/transfer" element={<ComingSoonPage title="Internal transfer" />} /><Route path="/p2p" element={<ComingSoonPage title="P2P marketplace" />} /><Route path="/profile" element={<ComingSoonPage title="Profile & security" />} /></Route><Route path="*" element={<Navigate to="/dashboard" replace />} /></Routes>; }
