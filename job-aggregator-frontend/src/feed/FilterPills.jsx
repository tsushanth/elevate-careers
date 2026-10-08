import React from 'react';
import RolePill from './RolePill';

const TYPES = [['full_time', 'Full-time'], ['part_time', 'Part-time'], ['contract', 'Contract']];
const DAYS = [['1', 'Past 24 hours'], ['7', 'Past week'], ['30', 'Past month']];

// `roles`/`role`/`onRoleChange` are optional: without roles there is no Role control.
export default function FilterPills({ filters, onChange, roles, role, onRoleChange }) {
  const set = (patch) => onChange({ ...filters, ...patch });
  const hasRole = !!(roles && roles.length && onRoleChange);
  const any = filters.remote || filters.type || filters.days || (hasRole && role);
  return (
    <div className="feed-pills" role="group" aria-label="Filters">
      <button type="button" className={`feed-pill${filters.remote ? ' on' : ''}`} aria-pressed={!!filters.remote}
        onClick={() => set({ remote: !filters.remote })}>Remote</button>
      <select className={`feed-pill${filters.days ? ' on' : ''}`} aria-label="Date posted" value={filters.days || ''}
        onChange={(e) => set({ days: e.target.value })}>
        <option value="">Date posted</option>
        {DAYS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <select className={`feed-pill${filters.type ? ' on' : ''}`} aria-label="Job type" value={filters.type || ''}
        onChange={(e) => set({ type: e.target.value })}>
        <option value="">Job type</option>
        {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {hasRole && <RolePill roles={roles} value={role} onChange={onRoleChange} />}
      {any && <button type="button" className="feed-clear" onClick={() => { set({ remote: false, type: '', days: '' }); if (hasRole && role) onRoleChange(''); }}>Clear all</button>}
    </div>
  );
}
