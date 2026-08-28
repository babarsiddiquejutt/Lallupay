import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Card, EmptyState, Button } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabaseClient';
import { getMyProfile } from '../lib/db/profiles';
import { formatTimestamp } from '../lib/formatters';
import type { Profile } from '../types/database';

type DocumentType = 'national_id_front' | 'national_id_back' | 'selfie';
const docLabels: Record<DocumentType, string> = {
  national_id_front: 'National ID — front',
  national_id_back: 'National ID — back',
  selfie: 'Selfie / photo',
};

interface KycSubmission {
  id: string;
  user_id: string;
  status: string;
  rejection_reason: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export function KycPage() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [submissions, setSubmissions] = useState<KycSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Upload form state
  const [files, setFiles] = useState<Record<DocumentType, File | null>>({
    national_id_front: null,
    national_id_back: null,
    selfie: null,
  });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!user || !supabase) return;
    try {
      setError('');
      const [profileData, subData] = await Promise.all([
        getMyProfile(user.id),
        supabase.from('kyc_submissions' as never).select('*').eq('user_id', user.id).order('created_at', { ascending: false }) as never,
      ]);
      setProfile(profileData);
      setSubmissions((subData as unknown as { data: KycSubmission[] | null })?.data ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load KYC data.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  const hasPending = submissions.some((s) => s.status === 'pending');
  const latestStatus = submissions.length > 0 ? submissions[0].status : null;

  async function submitKyc(event: FormEvent) {
    event.preventDefault();
    if (!user || !supabase) return;

    const requiredDocs: DocumentType[] = ['national_id_front', 'national_id_back', 'selfie'];
    const missing = requiredDocs.filter((d) => !files[d]);
    if (missing.length > 0) {
      setError(`Please upload: ${missing.map((d) => docLabels[d]).join(', ')}`);
      return;
    }

    setBusy(true);
    setError('');
    setNotice('');

    try {
      // 1. Create the KYC submission row (RLS: status must be 'pending')
      const { data: subResult, error: subError } = await supabase
        .from('kyc_submissions' as never)
        .insert({ user_id: user.id, status: 'pending' } as never)
        .select('id')
        .single();
      if (subError || !subResult) throw new Error(subError?.message ?? 'Failed to create KYC submission.');
      const submissionId = (subResult as unknown as { id: string }).id;

      // 2. Upload each document to storage
      for (const docType of requiredDocs) {
        const file = files[docType];
        if (!file) continue;
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `${user.id}/${submissionId}/${docType}-${safeName}`;
        const { error: uploadError } = await supabase.storage
          .from('kyc-documents')
          .upload(path, file, { upsert: false, contentType: file.type });
        if (uploadError) throw new Error(`Upload failed for ${docLabels[docType]}: ${uploadError.message}`);

        // 3. Record the document (RLS: user_id must match auth.uid())
        const { error: docError } = await supabase
          .from('kyc_documents' as never)
          .insert({ submission_id: submissionId, user_id: user.id, storage_path: path, document_type: docType } as never);
        if (docError) throw new Error(`Failed to record document: ${docError.message}`);
      }

      // 4. Update profile KYC status to pending
      await supabase.from('profiles').update({ kyc_status: 'pending' }).eq('id', user.id);

      setNotice('KYC documents submitted successfully. Our team will review your submission.');
      setFiles({ national_id_front: null, national_id_back: null, selfie: null });
      void load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'KYC submission failed.');
    } finally {
      setBusy(false);
    }
  }

  function handleFileChange(docType: DocumentType, file: File | null) {
    setFiles((prev) => ({ ...prev, [docType]: file }));
  }

  if (loading) return <main className="page"><p>Loading KYC status…</p></main>;

  return (
    <main className="page">
      <div className="hero">
        <span className="eyebrow">SANDBOX — NO REAL FUNDS</span>
        <h1>Identity verification</h1>
        <p>Submit your identity documents to verify your account. Verified accounts can access all platform features.</p>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="eyebrow" role="status">{notice}</p>}

      {/* Current Status */}
      <Card>
        <div className="section-heading">
          <h2>Verification status</h2>
          <span className={`status ${profile?.kyc_status === 'approved' ? 'completed' : profile?.kyc_status === 'rejected' ? 'cancelled' : 'pending'}`}>
            {profile?.kyc_status?.replace('_', ' ') ?? 'not started'}
          </span>
        </div>
        <ul className="transaction-list">
          <li><span>KYC tier</span><span>{profile?.kyc_tier ?? 0}</span></li>
          <li><span>Submissions</span><span>{submissions.length}</span></li>
          {latestStatus && <li><span>Latest status</span><span className={`status ${latestStatus === 'approved' ? 'completed' : latestStatus === 'rejected' ? 'cancelled' : 'pending'}`}>{latestStatus}</span></li>}
        </ul>
        {profile?.kyc_status === 'rejected' && submissions[0]?.rejection_reason && (
          <p style={{ marginTop: '0.5rem' }}><small style={{ color: 'var(--color-error)' }}>Rejection reason: {submissions[0].rejection_reason}</small></p>
        )}
      </Card>

      {/* Upload Form — only show if not already pending/approved */}
      {!hasPending && profile?.kyc_status !== 'approved' && (
        <Card>
          <h2>Submit documents</h2>
          <p>Upload clear photos of your identity documents. Accepted formats: JPEG, PNG, PDF (max 10 MB each).</p>
          <form onSubmit={(event) => void submitKyc(event)}>
            <label>
              {docLabels.national_id_front}
              <input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(event) => handleFileChange('national_id_front', event.target.files?.[0] ?? null)} required />
            </label>
            <label>
              {docLabels.national_id_back}
              <input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(event) => handleFileChange('national_id_back', event.target.files?.[0] ?? null)} required />
            </label>
            <label>
              {docLabels.selfie}
              <input type="file" accept="image/jpeg,image/png" onChange={(event) => handleFileChange('selfie', event.target.files?.[0] ?? null)} required />
            </label>
            <Button type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Submit for review'}</Button>
          </form>
        </Card>
      )}

      {hasPending && (
        <Card>
          <span className="eyebrow">Submission in progress</span>
          <h2>Your KYC is under review</h2>
          <p>A team member will review your documents. This typically takes 1–24 hours.</p>
        </Card>
      )}

      {/* Submission History */}
      {submissions.length > 0 && (
        <Card>
          <div className="section-heading"><h2>Submission history</h2><span>{submissions.length} submissions</span></div>
          <ul className="transaction-list">
            {submissions.map((s) => (
              <li key={s.id}>
                <span>Submission {s.id.slice(0, 8)}…</span>
                <span className={`status ${s.status === 'approved' ? 'completed' : s.status === 'rejected' ? 'cancelled' : 'pending'}`}>{s.status}</span>
                <span>{formatTimestamp(s.created_at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {submissions.length === 0 && (
        <Card>
          <EmptyState title="No submissions yet" body="Submit your identity documents above to get verified." />
        </Card>
      )}
    </main>
  );
}
