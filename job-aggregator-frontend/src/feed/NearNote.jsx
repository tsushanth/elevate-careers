import React from 'react';

// One line while the server orders jobs near the user first (`near` is the API's field, present only then),
// or, once the user switched that off, the way back. While off the server sends no `near`, so the way back
// relies on a label seen earlier in the session; with none, there is nothing to offer and nothing is shown.
export default function NearNote({ near, off, lastLabel, onTurnOff, onTurnOn }) {
  if (off) {
    if (!lastLabel) return null;
    return (
      <p className="feed-near-note">
        Showing jobs in the order posted.{' '}
        <button type="button" onClick={onTurnOn}>Show jobs near {lastLabel} first</button>
      </p>
    );
  }
  if (!near || !near.label) return null;
  return (
    <p className="feed-near-note">
      Showing jobs near {near.label} first.{' '}
      <button type="button" onClick={onTurnOff}>Show all jobs equally</button>
      {near.source === 'ip' && (
        <span className="feed-near-attrib">
          {' '}<a href="https://db-ip.com" target="_blank" rel="noopener noreferrer">IP geolocation by DB-IP</a>
        </span>
      )}
    </p>
  );
}
