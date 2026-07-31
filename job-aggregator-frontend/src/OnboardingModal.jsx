import React from 'react';

const EXTENSION_URL = 'https://chromewebstore.google.com/detail/simplyapply-%E2%80%94-ai-job-auto/ocdeebjeffdjmfgmclnlphkhfdcdpdkf';
const STORAGE_KEY = 'sa_onboarding_done';

export function shouldShowOnboarding() {
  try {
    return !localStorage.getItem(STORAGE_KEY);
  } catch { return false; }
}

export function markOnboardingDone() {
  try { localStorage.setItem(STORAGE_KEY, '1'); } catch {}
}

export default function OnboardingModal({ onDismiss }) {
  const handleInstall = () => {
    markOnboardingDone();
    window.open(EXTENSION_URL, '_blank', 'noopener,noreferrer');
    onDismiss();
  };

  const handleSkip = () => {
    markOnboardingDone();
    onDismiss();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      <div style={{
        background: '#0f172a',
        border: '1px solid rgba(37,99,235,0.35)',
        borderRadius: 16,
        padding: '40px 36px 32px',
        maxWidth: 480,
        width: '100%',
        textAlign: 'center',
        boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
      }}>
        {/* Icon */}
        <div style={{
          width: 64, height: 64, borderRadius: 16,
          background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 30, margin: '0 auto 24px',
          boxShadow: '0 8px 24px rgba(37,99,235,0.35)',
        }}>
          ⚡
        </div>

        <h2 style={{ color: '#f1f5f9', fontSize: 22, fontWeight: 700, margin: '0 0 10px' }}>
          One last step
        </h2>
        <p style={{ color: '#94a3b8', fontSize: 15, lineHeight: 1.6, margin: '0 0 28px' }}>
          Install the SimplyApply Chrome extension to autofill job applications in one click — directly on Greenhouse, Lever, Workday, and more.
        </p>

        {/* Steps */}
        <div style={{
          background: 'rgba(37,99,235,0.08)',
          border: '1px solid rgba(37,99,235,0.2)',
          borderRadius: 10,
          padding: '16px 20px',
          marginBottom: 28,
          textAlign: 'left',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          {[
            ['1', 'Click "Add to Chrome — Free" below'],
            ['2', 'Open any job application page'],
            ['3', 'Hit the SimplyApply button — done'],
          ].map(([num, text]) => (
            <div key={num} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{
                width: 24, height: 24, borderRadius: '50%',
                background: '#2563eb', color: '#fff',
                fontSize: 12, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>{num}</span>
              <span style={{ color: '#cbd5e1', fontSize: 14 }}>{text}</span>
            </div>
          ))}
        </div>

        <button
          onClick={handleInstall}
          style={{
            width: '100%',
            background: 'linear-gradient(90deg, #2563eb 0%, #1d4ed8 100%)',
            color: '#fff',
            border: 'none',
            borderRadius: 10,
            padding: '14px 24px',
            fontSize: 16,
            fontWeight: 700,
            cursor: 'pointer',
            marginBottom: 14,
            boxShadow: '0 4px 14px rgba(37,99,235,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Add to Chrome — Free
        </button>

        <button
          onClick={handleSkip}
          style={{
            background: 'none', border: 'none',
            color: '#64748b', fontSize: 13,
            cursor: 'pointer', padding: '4px 8px',
            textDecoration: 'underline',
          }}
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
