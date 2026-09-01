import { useState, useEffect, useCallback, useRef } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Button } from '../components/ui';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../hooks/useAuth';
import { checkLoginLock, recordLoginFailure, clearLoginAttempts } from '../lib/api/auth';

type AuthView = 'login' | 'register' | 'forgot-password' | 'verify-email';

const RESEND_COOLDOWN = 60; // seconds

export function AuthPage() {
  const { user } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [view, setView] = useState<AuthView>('login');
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'error' | 'success'>('error');
  const [busy, setBusy] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Brute-force lock state
  const [lockRemaining, setLockRemaining] = useState(0);
  const lockCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup countdowns on unmount
  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
      if (lockCountdownRef.current) clearInterval(lockCountdownRef.current);
    };
  }, []);

  const startLockCountdown = useCallback((seconds: number) => {
    setLockRemaining(seconds);
    if (lockCountdownRef.current) clearInterval(lockCountdownRef.current);
    lockCountdownRef.current = setInterval(() => {
      setLockRemaining((prev) => {
        if (prev <= 1) {
          if (lockCountdownRef.current) clearInterval(lockCountdownRef.current);
          setMessage('You can now try signing in again.');
          setMessageType('success');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const startCountdown = useCallback(() => {
    setCountdown(RESEND_COOLDOWN);
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const resendVerification = useCallback(async (targetEmail: string) => {
    if (!supabase || countdown > 0) return;
    setBusy(true);
    setMessage('');
    const { error } = await supabase.auth.resend({ type: 'signup', email: targetEmail });
    setBusy(false);
    if (error) {
      setMessage(error.message);
      setMessageType('error');
    } else {
      setMessage('Verification email sent. Check your inbox and spam folder.');
      setMessageType('success');
      startCountdown();
    }
  }, [countdown, startCountdown]);

  // Check lock on mount / when email changes
  useEffect(() => {
    if (view !== 'login' || !email) return;
    void checkLoginLock(email).then((status) => {
      if (status.locked && status.remaining_seconds > 0) {
        startLockCountdown(status.remaining_seconds);
      }
    });
  }, [email, view, startLockCountdown]);

  if (user) return <Navigate to="/dashboard" replace />;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setMessage('');
    setMessageType('error');

    if (view === 'forgot-password') {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth`,
      });
      setBusy(false);
      if (error) {
        setMessage(error.message);
      } else {
        // Clear any lock on this email since password reset is a recovery path
        void clearLoginAttempts(email);
        setLockRemaining(0);
        if (lockCountdownRef.current) clearInterval(lockCountdownRef.current);
        setMessage('Check your email for a password reset link.');
        setMessageType('success');
      }
      return;
    }

    if (view === 'register') {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/dashboard` },
      });
      setBusy(false);

      if (error) {
        setMessage(error.message);
        setMessageType('error');
        return;
      }

      // Check if email confirmation is required
      if (data.user && !data.session) {
        // No session = email confirmation required
        setView('verify-email');
        setMessage('Verification email sent. Check your inbox and spam folder.');
        setMessageType('success');
        startCountdown();
        return;
      }

      // Auto-confirmed (rare, but possible if mailer_autoconfirm is on)
      setMessage('Account created successfully.');
      setMessageType('success');
      return;
    }

    // ─── Login ───
    // Check lock before attempting
    const lockStatus = await checkLoginLock(email);
    if (lockStatus.locked && lockStatus.remaining_seconds > 0) {
      setBusy(false);
      startLockCountdown(lockStatus.remaining_seconds);
      setMessage(`Account temporarily locked due to too many failed attempts. Try again in ${formatLockTime(lockStatus.remaining_seconds)}.`);
      setMessageType('error');
      return;
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);

    if (error) {
      const msg = error.message.toLowerCase();

      // Record the failed attempt and check if we've now locked the account
      const updatedLock = await recordLoginFailure(email);

      // Detect unverified email
      if (msg.includes('email not confirmed') || msg.includes('verify your email')) {
        setView('verify-email');
        setMessage('Please verify your email address before logging in.');
        setMessageType('error');
        if (countdown === 0) {
          void resendVerification(email);
        }
        return;
      }

      if (updatedLock.locked && updatedLock.remaining_seconds > 0) {
        startLockCountdown(updatedLock.remaining_seconds);
        setMessage(`Account locked due to too many failed attempts. Try again in ${formatLockTime(updatedLock.remaining_seconds)}.`);
        setMessageType('error');
        return;
      }

      const remainingAttempts = 3 - updatedLock.attempts;
      if (remainingAttempts > 0 && remainingAttempts < 3) {
        setMessage(`Incorrect email or password. ${remainingAttempts} attempt${remainingAttempts === 1 ? '' : 's'} remaining before lockout.`);
        setMessageType('error');
        return;
      }

      setMessage(error.message);
      setMessageType('error');
      return;
    }

    // Check if user email is actually confirmed
    if (data.user && !data.user.confirmed_at && !data.user.email_confirmed_at) {
      setView('verify-email');
      setMessage('Please verify your email address before logging in.');
      setMessageType('error');
      if (countdown === 0) {
        void resendVerification(email);
      }
      return;
    }

    // Successful login — clear any failed attempts
    void clearLoginAttempts(email);
    setLockRemaining(0);
    if (lockCountdownRef.current) clearInterval(lockCountdownRef.current);
    setMessage('Signed in successfully.');
    setMessageType('success');
  }

  async function googleSignIn() {
    if (!supabase) return;
    setBusy(true);
    setMessage('');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/dashboard`,
        skipBrowserRedirect: false,
      },
    });
    if (error) {
      setBusy(false);
      if (error.message.includes('provider is not enabled')) {
        setMessage('Google sign-in is not yet configured. Please use email login or contact support.');
      } else if (error.message.includes('cancelled')) {
        setMessage('Sign-in was cancelled.');
      } else {
        setMessage(error.message || 'Google sign-in failed. Please try again or use email login.');
      }
      setMessageType('error');
    }
  }

  function getTitle(): string {
    switch (view) {
      case 'forgot-password': return 'Reset your password';
      case 'register': return 'Create your account';
      case 'verify-email': return 'Check your email';
      default: return 'Sign in';
    }
  }

  // Verification email view
  if (view === 'verify-email') {
    return (
      <main className="center-page">
        <section className="auth card">
          <div className="verification-state">
            <div className="icon">✉️</div>
            <h1 style={{ fontSize: '1.5rem' }}>{getTitle()}</h1>
            <p style={{ marginTop: '0.75rem' }}>
              We sent a verification link to
            </p>
            <p className="email" style={{ marginTop: '0.25rem', fontSize: '1rem' }}>{email}</p>
            <p style={{ marginTop: '1rem', fontSize: '0.875rem' }}>
              Click the link in the email to verify your account. Check your spam folder if you don&apos;t see it.
            </p>

            <div style={{ marginTop: '1.5rem', display: 'grid', gap: '0.75rem' }}>
              <Button
                onClick={() => void resendVerification(email)}
                disabled={busy || countdown > 0}
                className="secondary"
              >
                {busy ? 'Sending…' : countdown > 0 ? `Resend available in ${countdown}s` : 'Resend verification email'}
              </Button>

              {countdown > 0 && (
                <p className="countdown">
                  You can resend in {countdown} seconds
                </p>
              )}
            </div>

            {message && (
              <p role="status" style={{ marginTop: '1rem' }} className={messageType === 'error' ? 'error' : 'notice'}>
                {message}
              </p>
            )}

            <div style={{ marginTop: '1.5rem' }}>
              <button className="link-button" onClick={() => { setView('login'); setMessage(''); }}>
                Back to sign in
              </button>
            </div>
          </div>
        </section>
      </main>
    );
  }

  const title = getTitle();

  return (
    <main className="center-page">
      <section className="auth card">
        <span className="eyebrow">Welcome to LaluPay</span>
        <h1>{title}</h1>

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
          <Button disabled={busy || (view === 'login' && lockRemaining > 0)} type="submit">
            {busy ? 'Please wait…' : view === 'forgot-password' ? 'Send reset link' : view === 'register' ? 'Create account' : 'Sign in'}
          </Button>
        </form>

        {view !== 'forgot-password' && (
          <Button className="secondary" onClick={() => void googleSignIn()} disabled={busy}>Continue with Google</Button>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginTop: '0.5rem' }}>
          {view === 'login' && (
            <>
              <button className="link-button" onClick={() => { setView('forgot-password'); setMessage(''); }}>Forgot your password?</button>
              <button className="link-button" onClick={() => { setView('register'); setMessage(''); }}>New here? Create an account</button>
            </>
          )}
          {view === 'register' && (
            <button className="link-button" onClick={() => { setView('login'); setMessage(''); }}>Already have an account? Sign in</button>
          )}
          {view === 'forgot-password' && (
            <button className="link-button" onClick={() => { setView('login'); setMessage(''); }}>Back to sign in</button>
          )}
        </div>

        {lockRemaining > 0 && (
          <p role="status" className="error">
            Account locked. Try again in {formatLockTime(lockRemaining)}.
          </p>
        )}

        {message && (
          <p role="status" className={messageType === 'error' ? 'error' : 'notice'}>
            {message}
          </p>
        )}
        {location.state && <p role="status">Please sign in to continue.</p>}
      </section>
    </main>
  );
}

function formatLockTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}
