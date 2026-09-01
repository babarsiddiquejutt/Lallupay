import { useState, useCallback, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { appConfig } from './lib/config';
import { SetupPage } from './pages/SetupPage';
import { AppRoutes } from './routes';
import { useAuth } from './hooks/useAuth';
import { useAdmin } from './hooks/useAdmin';
import { Button } from './components/ui';

/* ───── Nav icon SVGs (inline, no dependency) ───── */
const icons = {
  home: <svg className="nav-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  wallet: <svg className="nav-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 10H2"/></svg>,
  convert: <svg className="nav-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>,
  transfer: <svg className="nav-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
  p2p: <svg className="nav-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  profile: <svg className="nav-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  admin: <svg className="nav-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
};

function Shell() {
  const { user, signOut } = useAuth();
  const { isAdmin } = useAdmin();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  // Close menu on route change
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  const handleSignOut = useCallback(() => { void signOut(); }, [signOut]);

  if (!user) {
    return (
      <>
        <AppRoutes />
      </>
    );
  }

  const navItems = [
    { to: '/dashboard', label: 'Home', icon: icons.home },
    { to: '/wallet', label: 'Wallet', icon: icons.wallet },
    { to: '/convert', label: 'Convert', icon: icons.convert },
    { to: '/p2p', label: 'P2P', icon: icons.p2p },
    { to: '/transfer', label: 'Transfer', icon: icons.transfer },
    { to: '/deposit', label: 'Deposit', icon: icons.home },
    { to: '/withdraw', label: 'Withdraw', icon: icons.wallet },
    { to: '/profile', label: 'Profile', icon: icons.profile },
  ];
  if (isAdmin) navItems.push({ to: '/admin', label: 'Admin', icon: icons.admin });

  return (
    <>
      {/* Header */}
      <header>
        <NavLink className="brand" to="/dashboard">LaluPay</NavLink>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Button className="secondary" style={{ width: 'auto', minHeight: '36px', padding: '0.375rem 0.75rem', fontSize: '0.8125rem' }} onClick={handleSignOut}>Sign out</Button>
          <button className="hamburger" onClick={() => setMenuOpen(true)} aria-label="Open menu">☰</button>
        </div>
      </header>

      {/* Desktop nav */}
      <nav className="desktop-nav" aria-label="Main navigation">
        {navItems.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/admin'}>{item.label}</NavLink>
        ))}
      </nav>

      {/* Mobile bottom nav */}
      <nav className="mobile-nav" aria-label="Mobile navigation">
        <div className="mobile-nav-inner">
          {navItems.slice(0, 5).map((item) => (
            <NavLink key={item.to} to={item.to}>
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          ))}
          {/* More menu for overflow items */}
          <button className="link-button" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', fontSize: '0.625rem', color: 'var(--text-muted)', minWidth: '48px', padding: '0.25rem' }} onClick={() => setMenuOpen(true)} aria-label="More menu">
            <svg className="nav-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
            <span>More</span>
          </button>
        </div>
      </nav>

      {/* Mobile side menu */}
      <div className={`mobile-menu-overlay ${menuOpen ? 'open' : ''}`} onClick={() => setMenuOpen(false)} />
      <div className={`mobile-menu ${menuOpen ? 'open' : ''}`}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="brand" style={{ fontSize: '1.125rem' }}>LaluPay</span>
          <button className="menu-close" onClick={() => setMenuOpen(false)} aria-label="Close menu">✕</button>
        </div>
        {navItems.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/admin'}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>{item.icon}{item.label}</span>
          </NavLink>
        ))}
        <div style={{ borderTop: '1px solid #ffffff12', marginTop: '0.5rem', paddingTop: '0.5rem' }}>
          <button className="link-button" style={{ width: '100%', textAlign: 'left', padding: '0.75rem 1rem', borderRadius: 'var(--radius-md)' }} onClick={handleSignOut}>Sign out</button>
        </div>
      </div>

      {/* Main content */}
      <AppRoutes />
    </>
  );
}

export function App() {
  return appConfig.isSupabaseConfigured ? (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  ) : (
    <SetupPage />
  );
}
