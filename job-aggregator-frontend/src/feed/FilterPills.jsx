import React from 'react';

const TYPES = [['full_time', 'Full-time'], ['part_time', 'Part-time'], ['contract', 'Contract']];
const DAYS = [['1', 'Past 24 hours'], ['7', 'Past week'], ['30', 'Past month']];

export default function FilterPills({ filters, onChange }) {
  const set = (patch) => onChange({ ...filters, ...patch });
  const any = filters.remote || filters.type || filters.days;
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
      {any && <button type="button" className="feed-clear" onClick={() => set({ remote: false, type: '', days: '' })}>Clear all</button>}
    </div>
  );
}
