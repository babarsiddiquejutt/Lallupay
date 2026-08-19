import { NavLink } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { appConfig } from './lib/config';
import { SetupPage } from './pages/SetupPage';
import { AppRoutes } from './routes';
import { useAuth } from './hooks/useAuth';
import { Button } from './components/ui';

function Shell() { const { user, signOut } = useAuth(); return <><header><NavLink className="brand" to="/dashboard">LaluPay</NavLink>{user && <Button className="secondary" onClick={() => void signOut()}>Sign out</Button>}</header><nav aria-label="Main navigation"><NavLink to="/dashboard">Home</NavLink><NavLink to="/wallet">Wallet</NavLink><NavLink to="/convert">Convert</NavLink><NavLink to="/transfer">Transfer</NavLink><NavLink to="/p2p">P2P</NavLink><NavLink to="/profile">Profile</NavLink></nav><AppRoutes /></>; }
export function App() { return appConfig.isSupabaseConfigured ? <AuthProvider><Shell /></AuthProvider> : <SetupPage />; }
