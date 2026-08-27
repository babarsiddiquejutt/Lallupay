import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button, Card } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { getMyProfile, updateMyProfile } from '../lib/db/profiles';
import { formatTimestamp } from '../lib/formatters';
import type { Profile } from '../types/database';

export function ProfilePage() {
  const { user, signOut } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [mobile, setMobile] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setError('');
      const data = await getMyProfile(user.id);
      setProfile(data);
      if (data) {
        setFullName(data.full_name ?? '');
        setUsername(data.username ?? '');
        setMobile(data.mobile ?? '');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load profile.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (!user) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const trimmedUsername = username.trim() || undefined;
      const trimmedMobile = mobile.trim() || undefined;
      const updated = await updateMyProfile(user.id, {
        full_name: fullName.trim() || undefined as unknown as string,
        username: trimmedUsername as unknown as string,
        mobile: trimmedMobile as unknown as string,
      });
      setProfile(updated);
      setEditing(false);
      setNotice('Profile updated.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update profile.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <main className="page"><p>Loading profile…</p></main>;

  return (
    <main className="page">
      <div className="hero">
        <span className="eyebrow">SANDBOX — NO REAL FUNDS</span>
        <h1>Profile &amp; security</h1>
        <p>Manage your account details.</p>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="eyebrow" role="status">{notice}</p>}

      <Card>
        {profile && !editing ? (
          <>
            <div className="section-heading"><h2>Account details</h2><button type="button" className="link-button" onClick={() => setEditing(true)}>Edit</button></div>
            <ul className="transaction-list">
              <li><span>Email</span><span>{user?.email ?? '—'}</span></li>
              <li><span>Full name</span><span>{profile.full_name || '—'}</span></li>
              <li><span>Username</span><span>{profile.username ? `@${profile.username}` : '—'}</span></li>
              <li><span>Mobile</span><span>{profile.mobile || '—'}</span></li>
              <li><span>KYC status</span><span className={`status ${profile.kyc_status === 'approved' ? 'completed' : 'pending'}`}>{profile.kyc_status.replace('_', ' ')}</span></li>
              <li><span>Member since</span><span>{formatTimestamp(profile.created_at)}</span></li>
            </ul>
          </>
        ) : (
          <form onSubmit={(event) => { event.preventDefault(); void saveProfile(event); }}>
            <div className="section-heading"><h2>Edit profile</h2><button type="button" className="link-button" onClick={() => { setEditing(false); setError(''); }}>Cancel</button></div>
            <label>Full name
              <input value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="e.g. Ali Khan" autoComplete="name" />
            </label>
            <label>Username
              <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="e.g. ali_k" pattern="^[a-z0-9_]{3,32}$" autoComplete="username" />
              <small>3–32 lowercase letters, numbers, underscores</small>
            </label>
            <label>Mobile number
              <input value={mobile} onChange={(event) => setMobile(event.target.value)} placeholder="e.g. 03xxxxxxxxx" autoComplete="tel" />
            </label>
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</Button>
          </form>
        )}
      </Card>

      <Card>
        <h2>Security</h2>
        <ul className="transaction-list">
          <li><span>Session</span><span>Active</span></li>
          <li><span>Email</span><span>{user?.email ?? '—'}</span></li>
        </ul>
        <div className="section-heading" style={{ gap: '1rem', marginTop: '1rem' }}>
          <Button className="secondary" onClick={() => void signOut()}>Sign out</Button>
        </div>
        <p><small>Two-factor authentication and session management are coming in a future release.</small></p>
      </Card>
    </main>
  );
}
