import React from 'react';

// Job-family select, same look as the other pills. Rendered only when the API returned roles
// (an empty list means the feature is off), so the control never appears half-working.
export default function RolePill({ roles, value, onChange }) {
  if (!roles || roles.length === 0) return null;
  return (
    <select className={`feed-pill feed-pill-role${value ? ' on' : ''}`} aria-label="Role" value={value || ''}
      onChange={(e) => onChange(e.target.value)}>
      <option value="">All roles</option>
      {roles.map(r => <option key={r.slug} value={r.slug}>{r.label}</option>)}
    </select>
  );
}
