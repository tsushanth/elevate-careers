import React, { useState } from 'react';
import { supabase } from './supabase';
import { trackFunnel } from './track';
import { useSiteStats, fmtCount } from './siteStats';

function AuthModal({ onSuccess, onClose, initialTab = 'signin', initialView = 'auth', notice = '' }) {
  const [tab, setTab] = useState(initialTab === 'signup' ? 'signup' : 'signin');
  // 'auth' = sign in / sign up, 'forgot' = ask for a password-reset email.
  const [view, setView] = useState(initialView === 'forgot' ? 'forgot' : 'auth');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState('');
  const [message, setMessage] = useState(notice);
  const stats = useSiteStats();

  const handleGoogle = async () => {
    trackFunnel('signup_start', { method: 'google' });
    setError('');
    setMessage('');
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin + window.location.pathname,
          queryParams: { prompt: 'select_account' },
        },
      });
      if (error) throw error;
      // Browser navigates to Google; the session is picked up by
      // onAuthStateChange when it redirects back.
    } catch (err) {
      setError(err.message || 'Google sign-in failed. Please try again.');
      setLoading(false);
    }
  };

  const handleForgot = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        // Same landing URL the Google sign-in uses. It must be on the Supabase "Redirect URLs" list.
        redirectTo: window.location.origin + window.location.pathname,
      });
      if (error) throw error;
      // Same wording whether or not the address has an account, so this cannot be used to probe for accounts.
      setMessage('If an account exists for that email, a reset link is on its way. Check your inbox and spam folder.');
    } catch (err) {
      setError(err.message || 'Could not send the reset email. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    try {
      if (tab === 'signin') {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onSuccess(data.session, false);
        onClose();
      } else {
        trackFunnel('signup_start', { method: 'password' });
        const source = JSON.parse(sessionStorage.getItem('sa_source') || '{}');
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { ...source, signup_via: 'website' } },
        });
        if (error) throw error;
        if (data.session) {
          onSuccess(data.session, true);
          onClose();
        } else {
          try { localStorage.setItem('sa_signup_pending', '1'); } catch {}
          setMessage('Check your email to confirm your account.');
        }
      }
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-overlay" onClick={onClose}>
      <div className="auth-modal" onClick={(e) => e.stopPropagation()}>
        <button className="auth-close" onClick={onClose} aria-label="Close">×</button>

        {view === 'forgot' ? (
          <>
            <h2 className="auth-title">Reset your password</h2>
            <p className="auth-subtitle">Enter your account email and we will send you a link to choose a new password.</p>
            <form onSubmit={handleForgot} className="auth-form">
              <div className="auth-field">
                <label htmlFor="auth-forgot-email">Email</label>
                <input
                  id="auth-forgot-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoComplete="email"
                />
              </div>
              {error && <p className="auth-error" role="alert">{error}</p>}
              {message && <p className="auth-message">{message}</p>}
              <button type="submit" className="auth-submit" disabled={loading}>
                {loading ? 'Please wait…' : 'Send reset link'}
              </button>
              <button type="button" className="auth-link" onClick={() => { setView('auth'); setTab('signin'); setError(''); setMessage(''); }}>
                Back to sign in
              </button>
            </form>
          </>
        ) : (
        <>
        <h2 className="auth-title">Welcome to SimplyApply</h2>
        <p className="auth-subtitle">
          {tab === 'signup'
            ? `${stats ? `${fmtCount(stats.jobs)} open jobs from ${fmtCount(stats.companies)} companies` : 'Real jobs from company career pages'}, and autofilled applications on Greenhouse, Lever, Ashby, and more — free.`
            : 'Welcome back — pick up your job search where you left off.'}
        </p>

        <div className="auth-tabs">
          <button
            className={`auth-tab ${tab === 'signin' ? 'active' : ''}`}
            onClick={() => { setTab('signin'); setError(''); setMessage(''); }}
          >
            Sign In
          </button>
          <button
            className={`auth-tab ${tab === 'signup' ? 'active' : ''}`}
            onClick={() => { setTab('signup'); setError(''); setMessage(''); }}
          >
            Sign Up
          </button>
        </div>

        <button type="button" className="auth-google" onClick={handleGoogle} disabled={loading}>
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.3 5.7c4.3-4 6.7-9.9 6.7-17.1z"/>
            <path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z"/>
            <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.3-5.7c-2 1.4-4.7 2.3-8.6 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/>
          </svg>
          Continue with Google
        </button>
        <div className="auth-or"><span>or</span></div>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="auth-field">
            <label htmlFor="auth-email">Email</label>
            <input
              id="auth-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
            />
          </div>

          <div className="auth-field">
            <label htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={tab === 'signup' ? 'Min 6 characters' : ''}
              required
              autoComplete={tab === 'signin' ? 'current-password' : 'new-password'}
            />
          </div>

          {tab === 'signin' && (
            <button type="button" className="auth-link" onClick={() => { setView('forgot'); setError(''); setMessage(''); }}>
              Forgot password?
            </button>
          )}

          {error && <p className="auth-error">{error}</p>}
          {message && <p className="auth-message">{message}</p>}

          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? 'Please wait…' : tab === 'signin' ? 'Sign In' : 'Create Account'}
          </button>
        </form>
        </>
        )}
      </div>
    </div>
  );
}

export default AuthModal;
