import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

const API_URL = 'https://elevate-careers-api.fly.dev';

const css = `
.adm{--bg:#f6f7f9;--card:#fff;--fg:#14171a;--mut:#667085;--line:#e4e7ec;--ok:#16a34a;--warn:#d97706;--bad:#dc2626;--bar:#0a66c2;--bar2:#98a2b3;
  background:var(--bg);color:var(--fg);min-height:100vh;padding:20px 16px 48px;font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}
@media (prefers-color-scheme:dark){.adm{--bg:#0f1115;--card:#171a21;--fg:#e8eaed;--mut:#98a2b3;--line:#262b36;--bar:#4c9aff;--bar2:#5b6577}}
.adm *{box-sizing:border-box}
.adm-wrap{max-width:1100px;margin:0 auto}
.adm h1{font-size:20px;margin:0}
.adm h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);margin:26px 0 10px}
.adm-top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.adm-sel button{background:var(--card);color:var(--fg);border:1px solid var(--line);padding:5px 11px;cursor:pointer;font:inherit}
.adm-sel button:first-child{border-radius:8px 0 0 8px}.adm-sel button:last-child{border-radius:0 8px 8px 0}
.adm-sel button.on{background:var(--bar);color:#fff;border-color:var(--bar)}
.adm-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.adm-card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.adm-card .n{font-size:24px;font-weight:700}.adm-card .l{color:var(--mut);font-size:12px}
.adm-banner{border-radius:10px;padding:10px 14px;margin:14px 0 0;border:1px solid var(--line);background:var(--card)}
.adm-banner.bad{border-color:var(--bad)}.adm-banner.warn{border-color:var(--warn)}
.adm-dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:7px}
.ok{background:var(--ok)}.warn{background:var(--warn)}.bad{background:var(--bad)}
.adm table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
.adm th,.adm td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);font-size:13px;vertical-align:top}
.adm th{color:var(--mut);font-weight:600}.adm tr:last-child td{border-bottom:0}
.adm-tw{overflow-x:auto}
.adm-bars{display:flex;align-items:flex-end;gap:3px;height:90px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px}
.adm-bars div{flex:1;display:flex;flex-direction:column;justify-content:flex-end;min-width:4px}
.adm-bars i{display:block;background:var(--bar);min-height:1px}.adm-bars i.b{background:var(--bar2)}
.adm-mut{color:var(--mut)}
.adm-2{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}
`;

const ago = (t) => {
  if (!t) return 'never';
  const s = (Date.now() - new Date(t).getTime()) / 1000;
  if (s < 90) return 'just now';
  if (s < 5400) return Math.round(s / 60) + 'm ago';
  if (s < 129600) return Math.round(s / 3600) + 'h ago';
  return Math.round(s / 86400) + 'd ago';
};
const ageH = (t) => (t ? (Date.now() - new Date(t).getTime()) / 3.6e6 : Infinity);
const fmt = (n) => (n == null ? '–' : Number(n).toLocaleString());

const Card = ({ n, l }) => <div className="adm-card"><div className="n">{fmt(n)}</div><div className="l">{l}</div></div>;

function Bars({ rows, a, b }) {
  const max = Math.max(1, ...rows.map((r) => (r[a] || 0) + (b ? r[b] || 0 : 0)));
  return (
    <div className="adm-bars">
      {rows.map((r) => (
        <div key={r.day} title={`${r.day}: ${r[a] || 0}${b ? ` + ${r[b] || 0} (you)` : ''}`}>
          {b && <i className="b" style={{ height: `${((r[b] || 0) / max) * 70}px` }} />}
          <i style={{ height: `${((r[a] || 0) / max) * 70}px` }} />
        </div>
      ))}
    </div>
  );
}

function Table({ cols, rows, empty }) {
  if (!rows?.length) return <div className="adm-card adm-mut">{empty || 'No data'}</div>;
  return (
    <div className="adm-tw"><table>
      <thead><tr>{cols.map((c) => <th key={c.h}>{c.h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c.h}>{c.f(r)}</td>)}</tr>)}</tbody>
    </table></div>
  );
}

export default function Admin() {
  const [state, setState] = useState('loading'); // loading | signin | denied | ok | error
  const [days, setDays] = useState(14);
  const [data, setData] = useState(null);
  const [health, setHealth] = useState(null);
  const [feedHealth, setFeedHealth] = useState(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const { data: s } = await supabase.auth.getSession();
    if (!s.session) { setState('signin'); return; }
    const t0 = performance.now();
    const { data: d, error } = await supabase.rpc('simplyapply_admin_overview', { p_days: days });
    const dbMs = Math.round(performance.now() - t0);
    if (error) {
      // Not an admin (or no permission): look like any unknown page.
      if (error.code === 'P0002' || error.code === '42501') { setState('denied'); return; }
      setErr(error.message); setState('error'); return;
    }
    setData(d); setState('ok');
    supabase
      .rpc('simplyapply_admin_feed_health')
      .then(({ data: fh, error: fe }) => setFeedHealth(fe ? null : (fh || null)))
      .catch(() => setFeedHealth(null));
    const a0 = performance.now();
    let api = { ok: false, ms: null };
    try {
      const r = await fetch(`${API_URL}/health`, { cache: 'no-store' });
      api = { ok: r.ok, ms: Math.round(performance.now() - a0) };
    } catch (_) { /* leave as down */ }
    setHealth({ api, db: { ok: true, ms: dbMs } });
  }, [days]);

  useEffect(() => {
    load();
    const { data: sub } = supabase.auth.onAuthStateChange((e) => { if (e === 'SIGNED_IN' || e === 'SIGNED_OUT') load(); });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  useEffect(() => { document.title = state === 'ok' ? 'Admin' : 'Not found'; }, [state]);

  if (state === 'loading') return <div className="adm"><style>{css}</style></div>;
  if (state === 'signin') {
    return (
      <div className="adm"><style>{css}</style><div className="adm-wrap">
        <button className="adm-card" style={{ cursor: 'pointer', color: 'inherit', font: 'inherit' }}
          onClick={() => supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + '/admin' } })}>
          Sign in with Google
        </button>
      </div></div>
    );
  }
  if (state === 'denied') return <div className="adm"><style>{css}</style><div className="adm-wrap"><h1>404</h1><p className="adm-mut">This page could not be found.</p></div></div>;
  if (state === 'error') return <div className="adm"><style>{css}</style><div className="adm-wrap"><div className="adm-card">Failed to load: {err}</div></div></div>;

  const d = data;
  const ingestAgeH = ageH(d.ingestion.last_ingested);
  const jobsAgeH = ageH(d.jobs.latest_added);
  const alerts = [];
  if (health && !health.api.ok) alerts.push(['bad', 'API /health is failing']);
  if (jobsAgeH > 72) alerts.push([jobsAgeH > 168 ? 'bad' : 'warn', `Job ingestion looks stalled: newest job added ${ago(d.jobs.latest_added)}, last source ingest ${ago(d.ingestion.last_ingested)}`]);
  if (d.repair.unresolved > 0) alerts.push(['warn', `${d.repair.unresolved} unresolved autofill failures in repair queue`]);
  if (d.autofill.fills_external_30d === 0) alerts.push(['warn', 'No autofills by anyone other than the admin in the last 30 days']);
  const worst = alerts.some((a) => a[0] === 'bad') ? 'bad' : alerts.length ? 'warn' : 'ok';

  return (
    <div className="adm"><style>{css}</style><div className="adm-wrap">
      <div className="adm-top">
        <div><h1>SimplyApply admin</h1><div className="adm-mut">Updated {ago(d.generated_at)} · admin accounts excluded unless noted · shared Supabase project, users counted by SimplyApply activity</div></div>
        <div className="adm-sel">{[7, 14, 30, 90].map((n) => <button key={n} className={n === days ? 'on' : ''} onClick={() => setDays(n)}>{n}d</button>)}</div>
      </div>

      <div className={`adm-banner ${worst === 'ok' ? '' : worst}`}>
        <span className={`adm-dot ${worst}`} />{worst === 'ok' ? 'All systems normal' : `${alerts.length} item(s) need attention`}
        {alerts.map(([lv, m], i) => <div key={i}><span className={`adm-dot ${lv}`} />{m}</div>)}
      </div>

      <h2>System health</h2>
      <div className="adm-grid">
        <div className="adm-card"><div className="n"><span className={`adm-dot ${health ? (health.api.ok ? 'ok' : 'bad') : 'warn'}`} />{health?.api.ms != null ? `${health.api.ms}ms` : '…'}</div><div className="l">API /health</div></div>
        <div className="adm-card"><div className="n"><span className="adm-dot ok" />{health ? `${health.db.ms}ms` : '…'}</div><div className="l">Supabase (admin query)</div></div>
        <div className="adm-card"><div className="n"><span className={`adm-dot ${ingestAgeH > 72 ? 'bad' : 'ok'}`} />{ago(d.ingestion.last_ingested)}</div><div className="l">Last source ingest</div></div>
        <div className="adm-card"><div className="n"><span className={`adm-dot ${jobsAgeH > 72 ? 'bad' : 'ok'}`} />{ago(d.jobs.latest_added)}</div><div className="l">Newest job added</div></div>
      </div>

      <h2>Users</h2>
      <div className="adm-grid">
        <Card n={d.users.total} l="SimplyApply users" /><Card n={d.users.new_7d} l="New (7d)" /><Card n={d.users.new_30d} l="New (30d)" />
        <Card n={d.users.active_7d} l="Signed in (7d)" /><Card n={d.users.active_30d} l="Signed in (30d)" />
        <Card n={d.extension.installed_ever} l="Extension installed" /><Card n={d.extension.seen_7d} l="Extension seen (7d)" />
      </div>
      <h2>New signups per day ({days}d)</h2>
      <Bars rows={d.signups_by_day} a="n" />
      <h2>Recent users</h2>
      <Table rows={d.recent_users} empty="No users yet"
        cols={[{ h: 'Email', f: (r) => r.email }, { h: 'Signed up', f: (r) => ago(r.created_at) }, { h: 'Last seen', f: (r) => ago(r.last_sign_in_at) },
          { h: 'Method', f: (r) => r.providers || '–' }, { h: 'Fills', f: (r) => r.fills }, { h: 'Ext', f: (r) => (r.has_extension ? 'yes' : '') }]} />

      <h2>Autofill</h2>
      <div className="adm-grid">
        <Card n={d.autofill.fills_external_7d} l="Fills, others (7d)" /><Card n={d.autofill.fills_external_30d} l="Fills, others (30d)" />
        <Card n={d.autofill.users_external_30d} l="Users who filled (30d)" /><Card n={d.autofill.fills_all} l="Fills, all time (incl. you)" />
        <Card n={d.autofill.submitted} l="Marked submitted" /><Card n={d.autofill.ai_used} l="Fills using AI" />
        <Card n={d.ai.calls_total} l="AI calls (others)" /><Card n={d.ai.users} l="Users with AI calls" />
      </div>
      <div className="adm-mut" style={{ marginTop: 8 }}>Last fill by anyone: {ago(d.autofill.last_fill)}</div>
      <h2>Fills per day ({days}d) <span style={{ textTransform: 'none', letterSpacing: 0 }}>— blue: others, grey: you</span></h2>
      <Bars rows={d.fills_by_day} a="external" b="admin" />

      <div className="adm-2">
        <div>
          <h2>Top sites filled ({days}d, incl. you)</h2>
          <Table rows={d.top_domains} cols={[{ h: 'Host', f: (r) => r.host }, { h: 'Fills', f: (r) => r.n }]} empty="No fills in window" />
        </div>
        <div>
          <h2>Plans</h2>
          <Table rows={Object.entries(d.tiers).map(([k, v]) => ({ k, v }))} cols={[{ h: 'Tier', f: (r) => r.k }, { h: 'Users', f: (r) => r.v }]} empty="No profiles" />
        </div>
      </div>

      <h2>Funnel events</h2>
      <Table rows={d.funnel} cols={[{ h: 'Event', f: (r) => r.event_name }, { h: `Last ${days}d`, f: (r) => r.n_window }, { h: 'All time', f: (r) => r.n_all }, { h: 'Last seen', f: (r) => ago(r.last_seen) }]} empty="No events" />

      <h2>Jobs & ingestion</h2>
      <div className="adm-grid">
        <Card n={d.jobs.total_approx} l="Jobs (approx.)" /><Card n={d.jobs.added_24h} l="Added (24h)" /><Card n={d.jobs.added_7d} l="Added (7d, newest 50k)" />
        <Card n={d.ingestion.sources_enabled} l="Sources enabled" /><Card n={d.ingestion.ingested_24h} l="Sources ingested (24h)" />
      </div>

      <h2>Autofill repair queue ({d.repair.unresolved} unresolved)</h2>
      <Table rows={d.repair.top} empty="Nothing unresolved"
        cols={[{ h: 'Site', f: (r) => r.domain }, { h: 'Field', f: (r) => r.label }, { h: 'Type', f: (r) => r.field_type }, { h: 'Reason', f: (r) => r.fail_reason }, { h: 'Count', f: (r) => r.count }, { h: 'Last', f: (r) => ago(r.last_seen) }]} />
      {feedHealth && (
        <>
          <h2>Home feed read model</h2>
          <div className="adm-grid">
            <Card n={feedHealth.feed_rows} l="job_feed rows (approx.)" />
            <Card n={feedHealth.active_jobs_missing_from_feed} l="Active jobs missing from feed (newest 50k)" />
            <Card n={feedHealth.inactive_job_active_in_feed} l="Inactive jobs still live in feed (sample)" />
            <Card n={feedHealth.unknown_location_jobs} l="Jobs with unknown location" />
            <Card n={feedHealth.places} l="Typeahead places" />
          </div>
        </>
      )}
    </div></div>
  );
}
