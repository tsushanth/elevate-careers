import React from 'react';

// One line under the heading while the signed-in default list is shaped by saved preferences.
// `status` is the API's `prefs` field: 'applied' (filtering on) or 'off' (user switched it off).
// The switch back is always one click away, so preferences can never trap the user.
export default function PrefsNote({ status, onShowAll, onUsePreferences }) {
  if (status === 'applied') {
    return (
      <p className="feed-prefs-note" role="status">
        Showing jobs that match your preferences.{' '}
        <button type="button" onClick={onShowAll}>Show all jobs</button>
      </p>
    );
  }
  if (status === 'off') {
    return (
      <p className="feed-prefs-note" role="status">
        Showing all jobs.{' '}
        <button type="button" onClick={onUsePreferences}>Use my preferences</button>
      </p>
    );
  }
  return null;
}
