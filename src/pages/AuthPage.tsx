import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Button } from '../components/ui';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../hooks/useAuth';

type AuthView = 'login' | 'register' | 'forgot-password';

export function AuthPage() {
  const { user } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [view, setView] = useState<AuthView>('login');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/dashboard" replace />;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setMessage('');

    if (view === 'forgot-password') {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth`,
      });
      setBusy(false);
      setMessage(error ? error.message : 'Check your email for a password reset link.');
      return;
    }

    const result = view === 'register'
      ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/dashboard` } })
      : await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    setMessage(result.error ? result.error.message : view === 'register' ? 'Check your email to verify your account.' : 'Signed in successfully.');
  }

  async function googleSignIn() {
    if (supabase) await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/dashboard` },
    });
  }

  const title = view === 'forgot-password' ? 'Reset your password' : view === 'register' ? 'Create your account' : 'Sign in securely';

  return (
    <main className="center-page">
      <section className="auth card">
        <span className="eyebrow">Welcome to LaluPay</span>
        <h1>{title}</h1>
        {view !== 'forgot-password' && <p>Sandbox environment — no real funds.</p>}

        <form onSubmit={(event) => void submit(event)}>
          <label>
            Email
            <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
          </label>
          {view !== 'forgot-password' && (
            <label>
              Password
              <input required minLength={8} type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={view === 'register' ? 'new-password' : 'current-password'} />
            </label>
          )}
          <Button disabled={busy} type="submit">
            {busy ? 'Please wait…' : view === 'forgot-password' ? 'Send reset link' : view === 'register' ? 'Create account' : 'Sign in'}
          </Button>
        </form>

        {view !== 'forgot-password' && (
          <Button className="secondary" onClick={() => void googleSignIn()}>Continue with Google</Button>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginTop: '0.5rem' }}>
          {view === 'login' && (
            <button className="link-button" onClick={() => { setView('forgot-password'); setMessage(''); }}>Forgot your password?</button>
          )}
          {view !== 'forgot-password' && (
            <button className="link-button" onClick={() => { setView(view === 'register' ? 'login' : 'register'); setMessage(''); }}>
              {view === 'register' ? 'Already have an account? Sign in' : 'New here? Create an account'}
            </button>
          )}
          {view === 'forgot-password' && (
            <button className="link-button" onClick={() => { setView('login'); setMessage(''); }}>Back to sign in</button>
          )}
        </div>

        {message && <p role="status">{message}</p>}
        {location.state && <p role="status">Please sign in to continue.</p>}
      </section>
    </main>
  );
}
