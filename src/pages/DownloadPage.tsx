import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { appConfig } from '../lib/config';

type Platform = 'android' | 'ios' | 'windows' | 'macos' | 'web';

const APP_VERSION = '1.0.0';
const APK_URL = appConfig.androidDownloadUrl || '/downloads/LaluPay-Android-v1.0.0.apk';
const WEB_URL = 'https://lalupay.kesug.com';

interface PlatformInfo {
  id: Platform;
  name: string;
  description: string;
  icon: string;
  actionLabel: string;
  actionHref: string;
  actionTarget?: string;
  details: string;
}

function detectPlatform(): Platform {
  const ua = navigator.userAgent.toLowerCase();
  if (/android/.test(ua)) return 'android';
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (/win/.test(ua)) return 'windows';
  if (/mac/.test(ua)) return 'macos';
  return 'web';
}

function PlatformCard({ info, highlighted }: { info: PlatformInfo; highlighted?: boolean }) {
  const [copied, setCopied] = useState(false);

  const handleWebCopy = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(WEB_URL);
      } else {
        const ta = document.createElement('textarea');
        ta.value = WEB_URL;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  return (
    <section
      className="card"
      style={{
        position: 'relative',
        border: highlighted ? '2px solid var(--brand-blue)' : undefined,
      }}
    >
      {highlighted && (
        <span
          style={{
            position: 'absolute',
            top: '12px',
            right: '12px',
            background: 'var(--brand-blue)',
            color: 'var(--brand-black)',
            fontSize: '0.6875rem',
            fontWeight: 700,
            padding: '0.2rem 0.6rem',
            borderRadius: '999px',
          }}
        >
          Recommended
        </span>
      )}
      <div style={{ fontSize: '2.5rem', lineHeight: 1, marginBottom: '0.5rem' }}>{info.icon}</div>
      <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.125rem', fontWeight: 700 }}>{info.name}</h2>
      <p style={{ margin: '0 0 0.75rem', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
        {info.description}
      </p>
      <p style={{ margin: '0 0 1rem', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
        {info.details}
      </p>
      {info.id === 'web' ? (
        <button className="button secondary" onClick={handleWebCopy}>
          {copied ? '✓ Copied to clipboard' : 'Copy Web App URL'}
        </button>
      ) : info.id === 'android' ? (
        <a className="button" href={info.actionHref} download style={{ textDecoration: 'none' }}>
          {info.actionLabel}
        </a>
      ) : info.actionHref.startsWith('#') ? (
        <span className="button secondary" style={{ opacity: 0.6, cursor: 'default' }}>
          {info.actionLabel}
        </span>
      ) : (
        <a
          className="button secondary"
          href={info.actionHref}
          target={info.actionTarget}
          rel={info.actionTarget === '_blank' ? 'noopener noreferrer' : undefined}
          style={{ textDecoration: 'none' }}
        >
          {info.actionLabel}
        </a>
      )}
    </section>
  );
}

export function DownloadPage() {
  const [detected, setDetected] = useState<Platform>('web');

  useEffect(() => {
    setDetected(detectPlatform());
  }, []);

  const platforms: PlatformInfo[] = [
    {
      id: 'android',
      name: 'Android',
      description: 'Install LaluPay on your Android phone or tablet.',
      icon: '📱',
      actionLabel: 'Download Android App',
      actionHref: APK_URL,
      details: `LaluPay v${APP_VERSION} — APK installer for Android 7.0+`,
    },
    {
      id: 'ios',
      name: 'iPhone / iPad',
      description: 'Add LaluPay to your home screen for a native app experience.',
      icon: '🍎',
      actionLabel: 'View Install Instructions',
      actionHref: '#ios-install',
      details: 'Install as a PWA via Safari → Share → Add to Home Screen.',
    },
    {
      id: 'windows',
      name: 'Windows',
      description: 'Install LaluPay as a desktop application on Windows.',
      icon: '🖥️',
      actionLabel: 'Coming Soon',
      actionHref: '#windows-download',
      details: `LaluPay v${APP_VERSION} — Native Windows app in development`,
    },
    {
      id: 'macos',
      name: 'macOS',
      description: 'Install LaluPay as a native macOS application.',
      icon: '💻',
      actionLabel: 'Coming Soon',
      actionHref: '#macos-download',
      details: `LaluPay v${APP_VERSION} — Native macOS app in development`,
    },
    {
      id: 'web',
      name: 'Web App',
      description: 'Use LaluPay directly in your browser — no installation needed.',
      icon: '🌐',
      actionLabel: 'Copy Web App URL',
      actionHref: WEB_URL,
      details: 'Works on any device with a modern browser.',
    },
  ];

  return (
    <main className="page">
      <div className="hero">
        <span className="eyebrow">GET LALUPAY</span>
        <h1>Get LaluPay on your device</h1>
        <p>
          LaluPay is available on all your devices. Choose your platform below.
          {' '}We detected you&apos;re on{' '}
          <strong style={{ color: 'var(--brand-blue)' }}>{detected}</strong>.
        </p>
      </div>

      {/* iOS install instructions */}
      {detected === 'ios' && (
        <section
          id="ios-install"
          className="card"
          style={{
            marginBottom: '1.5rem',
            border: '1px solid var(--brand-blue)',
            background: 'var(--brand-surface-2)',
          }}
        >
          <h2 style={{ margin: '0 0 0.75rem', fontSize: '1rem', fontWeight: 700 }}>
            📲 Add LaluPay to Home Screen (iOS)
          </h2>
          <ol style={{ margin: 0, paddingLeft: '1.25rem', color: 'var(--text-secondary)', fontSize: '0.9375rem', lineHeight: 1.8 }}>
            <li>Open <strong>Safari</strong> and visit <a href={WEB_URL} style={{ color: 'var(--brand-blue)' }}>{WEB_URL}</a></li>
            <li>Tap the <strong>Share</strong> button (square with up arrow) at the bottom</li>
            <li>Scroll down and tap <strong>&quot;Add to Home Screen&quot;</strong></li>
            <li>Tap <strong>Add</strong> in the top right corner</li>
            <li>LaluPay now appears on your home screen like a native app</li>
          </ol>
          <p style={{ marginTop: '0.75rem', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
            This gives you a full-screen app experience.
          </p>
        </section>
      )}

      {/* Platform cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))',
          gap: '1rem',
          marginTop: '1rem',
        }}
      >
        {platforms.map((p) => (
          <PlatformCard
            key={p.id}
            info={p}
            highlighted={p.id === detected}
          />
        ))}
      </div>

      {/* iOS additional info */}
      {detected === 'ios' && (
        <section className="card" style={{ marginTop: '1.5rem' }}>
          <h2 style={{ margin: '0 0 0.5rem', fontSize: '1rem', fontWeight: 700 }}>
            🍎 iOS / iPadOS
          </h2>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.9375rem' }}>
            LaluPay for iOS will be available on the Apple App Store soon. In the meantime,
            you can install LaluPay as a Progressive Web App (PWA) using the instructions above.
            The PWA provides a near-native experience with full functionality.
          </p>
        </section>
      )}

      {/* Windows / macOS info */}
      {(detected === 'windows' || detected === 'macos') && (
        <section className="card" style={{ marginTop: '1.5rem' }}>
          <h2 style={{ margin: '0 0 0.5rem', fontSize: '1rem', fontWeight: 700 }}>
            🖥️ Desktop Apps
          </h2>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.9375rem' }}>
            Native desktop applications for Windows and macOS are coming soon. You can use
            LaluPay in your browser now, or install it as a PWA from the browser for an
            app-like experience on your desktop.
          </p>
        </section>
      )}

      {/* Bottom CTA */}
      <div style={{ textAlign: 'center', marginTop: '2rem', paddingBottom: '1rem' }}>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
          Looking for LaluPay on another platform?
        </p>
        <Link
          to="/dashboard"
          className="button secondary"
          style={{ display: 'inline-flex', width: 'auto', marginTop: '0.75rem' }}
        >
          ← Back to Dashboard
        </Link>
      </div>
    </main>
  );
}
