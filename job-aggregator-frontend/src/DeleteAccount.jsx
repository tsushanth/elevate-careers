import React, { useEffect } from 'react';

const SUPPORT = 'support@simplyappl.ai';
const MAILTO = `mailto:${SUPPORT}?subject=${encodeURIComponent('Delete my SimplyApply account')}` +
  `&body=${encodeURIComponent('Please delete my SimplyApply account and all data linked to it.\n\nSign-in email: (the email address you use to sign in)\n')}`;

const h2 = { fontSize: 18, fontWeight: 600, color: '#f8fafc', marginBottom: 12 };
const section = { marginBottom: 36 };
const link = { color: '#60a5fa' };

export default function DeleteAccount() {
  useEffect(() => { document.title = 'Delete your SimplyApply account'; }, []);

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a' }}>
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '60px 24px 120px', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif', lineHeight: 1.7 }}>
      <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 8, color: '#f8fafc' }}>Delete your SimplyApply account</h1>
      <p style={{ color: '#94a3b8', marginBottom: 40 }}>
        For the SimplyApply app for Android and simplyappl.ai. Last updated: September 2026.
      </p>

      <section style={section}>
        <h2 style={h2}>How to request deletion</h2>
        <ol style={{ paddingLeft: 22 }}>
          <li style={{ marginBottom: 10 }}>
            Email <a href={MAILTO} style={link}>{SUPPORT}</a> from the address you use to sign in to SimplyApply,
            with the subject "Delete my SimplyApply account". The button below opens a ready-made email.
          </li>
          <li style={{ marginBottom: 10 }}>
            We reply to confirm the request. We use your sign-in email to check that the request is yours.
          </li>
          <li>We delete your account and data within 30 days of your request, and email you when it is done.</li>
        </ol>
        <a href={MAILTO} style={{
          display: 'inline-block', marginTop: 14, background: '#0a66c2', color: '#fff', textDecoration: 'none',
          borderRadius: 24, padding: '10px 22px', fontWeight: 600,
        }}>Email a deletion request</a>
      </section>

      <section style={section}>
        <h2 style={h2}>What we delete</h2>
        <ul style={{ paddingLeft: 20 }}>
          <li style={{ marginBottom: 6 }}>Your sign-in (email address and password)</li>
          <li style={{ marginBottom: 6 }}>Your profile, including your name, phone number and resume text</li>
          <li style={{ marginBottom: 6 }}>Your shortlisted jobs and job preferences</li>
          <li style={{ marginBottom: 6 }}>Your skill check results and "skills you're missing" records</li>
          <li>Your job fit checks and application tracking records</li>
        </ul>
      </section>

      <section style={section}>
        <h2 style={h2}>What we keep</h2>
        <p>
          Nothing that identifies you. Job listings are public postings from employers, not your data, so they stay on
          the site. Deleted data can remain in our encrypted database backups for up to 30 days, after which the backups
          are replaced and it is gone for good.
        </p>
      </section>

      <section style={section}>
        <h2 style={h2}>Delete only some of your data</h2>
        <p>
          You don't have to delete your account. In the app you can remove any shortlisted job at any time. To have other
          data removed, such as your saved resume text or job preferences, email <a href={`mailto:${SUPPORT}`} style={link}>{SUPPORT}</a> and
          tell us what to remove.
        </p>
      </section>

      <section style={section}>
        <h2 style={h2}>Data in your browser</h2>
        <p>
          If you use the SimplyApply Chrome extension, it also keeps your profile in your own browser. Uninstalling the
          extension removes that copy. It is separate from the data on our servers described above.
        </p>
      </section>

      <p style={{ color: '#94a3b8' }}>
        See our <a href="/privacy" style={link}>Privacy Policy</a> for how we handle your data while your account is active.
      </p>
    </div>
    </div>
  );
}
