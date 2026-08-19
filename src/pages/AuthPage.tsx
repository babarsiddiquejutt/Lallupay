import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Button } from '../components/ui';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../hooks/useAuth';

export function AuthPage() {
  const { user } = useAuth(); const location = useLocation();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [isRegistering, setIsRegistering] = useState(false); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/dashboard" replace />;
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase) return; setBusy(true); setMessage('');
    const result = isRegistering ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/dashboard` } }) : await supabase.auth.signInWithPassword({ email, password });
    setBusy(false); setMessage(result.error ? result.error.message : isRegistering ? 'Check your email to verify your account.' : 'Signed in successfully.');
  }
  async function googleSignIn() { if (supabase) await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/dashboard` } }); }
  return <main className="center-page"><section className="auth card"><span className="eyebrow">Welcome to LaluPay</span><h1>{isRegistering ? 'Create your account' : 'Sign in securely'}</h1><p>Sandbox environment — no real funds.</p><form onSubmit={submit}><label>Email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Password<input required minLength={8} type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><Button disabled={busy} type="submit">{busy ? 'Please wait…' : isRegistering ? 'Create account' : 'Sign in'}</Button></form><Button className="secondary" onClick={() => void googleSignIn()}>Continue with Google</Button><button className="link-button" onClick={() => setIsRegistering((value) => !value)}>{isRegistering ? 'Already have an account? Sign in' : 'New here? Create an account'}</button>{message && <p role="status">{message}</p>} {location.state && <p role="status">Please sign in to continue.</p>}</section></main>;
}
