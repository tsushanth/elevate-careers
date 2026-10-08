import React from 'react';

const MAX_LABELS = 3;

export function describeLabels(labels) {
  const list = (labels || []).filter(Boolean);
  const shown = list.slice(0, MAX_LABELS).join(', ');
  return list.length > MAX_LABELS ? `${shown} +${list.length - MAX_LABELS} more` : shown;
}

// One line under the heading while the signed-in default list is shaped by the saved profile or preferences.
// `status` is the API's `prefs` field: 'applied' (filtering on) or 'off' (user switched it off).
// `match` is the API's match object; only a profile match gets the profile wording.
// `hadProfile` says the list the user switched off was a profile match, so the way back names the profile.
// The switch back is always one click away, so this can never trap the user.
export default function PrefsNote({ status, match, hadProfile, onShowAll, onUsePreferences }) {
  if (status === 'applied') {
    const labels = match?.source === 'profile' ? describeLabels(match.labels) : '';
    return (
      <p className="feed-prefs-note" role="status">
        {labels ? `Showing jobs matched to your profile: ${labels}.` : 'Showing jobs that match your preferences.'}{' '}
        <button type="button" onClick={onShowAll}>Show all jobs</button>
      </p>
    );
  }
  if (status === 'off') {
    return (
      <p className="feed-prefs-note" role="status">
        Showing all jobs.{' '}
        <button type="button" onClick={onUsePreferences}>{hadProfile ? 'Use my profile' : 'Use my preferences'}</button>
      </p>
    );
  }
  return null;
}
