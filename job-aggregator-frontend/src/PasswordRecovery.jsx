import React, { useState } from 'react';
import { supabase } from './supabase';

// Shown after the user opens the link in a password-reset email (supabase-js signs them in with a
// recovery session and fires PASSWORD_RECOVERY). Sets the new password with updateUser.
export default function PasswordRecovery({ onDone, onClose }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < 6) { setError('Use at least 6 characters.'); return; }
    if (password !== confirm) { setError('The two passwords do not match.'); return; }
    setLoading(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) throw err;
      setDone(true);
    } catch (err) {
      setError(err.message || 'Could not update your password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-overlay" role="dialog" aria-modal="true" aria-labelledby="recovery-title">
      <div className="auth-modal" onClick={(e) => e.stopPropagation()}>
        {!done && <button className="auth-close" onClick={onClose} aria-label="Close">×</button>}
        <h2 className="auth-title" id="recovery-title">{done ? 'Password updated' : 'Set a new password'}</h2>
        {done ? (
          <>
            <p className="auth-message">Your password has been changed and you are signed in.</p>
            <button type="button" className="auth-submit" onClick={onDone}>Continue</button>
          </>
        ) : (
          <form onSubmit={submit} className="auth-form">
            <div className="auth-field">
              <label htmlFor="recovery-password">New password</label>
              <input id="recovery-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="Min 6 characters" required autoComplete="new-password" autoFocus />
            </div>
            <div className="auth-field">
              <label htmlFor="recovery-confirm">Confirm new password</label>
              <input id="recovery-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
                required autoComplete="new-password" />
            </div>
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button type="submit" className="auth-submit" disabled={loading}>{loading ? 'Please wait…' : 'Update password'}</button>
          </form>
        )}
      </div>
    </div>
  );
}
