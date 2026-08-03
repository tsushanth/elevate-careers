import React, { useState, useEffect } from 'react';

const sectionStyle = {
  background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 24, marginBottom: 20,
};
const headingStyle = {
  fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#64748b', marginBottom: 14,
};
const hintStyle = { fontSize: 12, color: '#94a3b8', marginBottom: 14 };

function CertLinks({ certifications }) {
  if (!certifications?.length) return null;
  return (
    <div style={{ marginTop: 4, fontSize: 11.5, color: '#6366f1' }}>
      {certifications.map((c, i) => (
        <React.Fragment key={c.name}>
          {i > 0 && ' · '}
          <a href={c.url} target="_blank" rel="noopener noreferrer" style={{ color: '#6366f1' }}>{c.name}</a>
        </React.Fragment>
      ))}
    </div>
  );
}

export default function GrowthTab({ session, API_URL }) {
  const [gapPath, setGapPath] = useState(null);
  const [gapPathLoading, setGapPathLoading] = useState(true);
  const [gapPathError, setGapPathError] = useState(null);

  const [aiOpps, setAiOpps] = useState(null);
  const [aiOppsLoading, setAiOppsLoading] = useState(true);
  const [aiOppsError, setAiOppsError] = useState(null);

  useEffect(() => {
    if (!session) return;
    const headers = { Authorization: `Bearer ${session.access_token}` };

    fetch(`${API_URL}/api/ai-resume/skills/gap-path`, { headers })
      .then(r => r.json())
      .then(data => { if (data.error) throw new Error(data.message || data.error); setGapPath(data); })
      .catch(e => setGapPathError(e.message))
      .finally(() => setGapPathLoading(false));

    fetch(`${API_URL}/api/ai-resume/skills/ai-opportunities`, { headers })
      .then(r => r.json())
      .then(data => { if (data.error) throw new Error(data.message || data.error); setAiOpps(data); })
      .catch(e => setAiOppsError(e.message))
      .finally(() => setAiOppsLoading(false));
  }, [session, API_URL]);

  return (
    <div style={{ maxWidth: 780, margin: '0 auto', padding: '24px 16px 80px' }}>

      <div style={sectionStyle}>
        <div style={headingStyle}>Skill gap path</div>
        <div style={hintStyle}>Skills that keep showing up as missing across the jobs you've browsed — the more you browse, the more this fills in.</div>
        {gapPathLoading && <div style={{ fontSize: 13, color: '#94a3b8' }}>Loading…</div>}
        {gapPathError && <div style={{ fontSize: 13, color: '#b91c1c' }}>Failed: {gapPathError}</div>}
        {gapPath && (
          gapPath.skills.length === 0 ? (
            <div style={{ fontSize: 13, color: '#94a3b8' }}>
              {gapPath.totalJobsSeen > 0 ? 'No recurring gaps yet.' : 'Browse a few job postings with the extension active to build this up.'}
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10 }}>Based on {gapPath.totalJobsSeen} job(s) seen</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {gapPath.skills.map(s => (
                  <li key={s.skill} style={{ marginBottom: 12, fontSize: 13.5, color: '#334155' }}>
                    <div>{s.skill}{s.missingInPct != null ? ` — missing in ${s.missingInPct}% of jobs seen` : ''}</div>
                    <CertLinks certifications={s.certifications} />
                    {s.unlocksJobs?.length > 0 && (
                      <div style={{ marginTop: 4, fontSize: 12, color: '#16a34a' }}>
                        🔓 Learn this and you'd unlock: {s.unlocksJobs.map((j, i) => (
                          <React.Fragment key={j.url}>
                            {i > 0 && ' · '}
                            <a href={j.url} target="_blank" rel="noopener noreferrer" style={{ color: '#16a34a' }}>{j.title}</a>
                          </React.Fragment>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )
        )}
      </div>

      <div style={sectionStyle}>
        <div style={headingStyle}>AI-era opportunities</div>
        <div style={hintStyle}>A snapshot of AI-related roles posted in the last 90 days — what's prevalent right now, not a growth claim (our own posting volume changed too much over time to trust a trend).</div>
        {aiOppsLoading && <div style={{ fontSize: 13, color: '#94a3b8' }}>Loading…</div>}
        {aiOppsError && <div style={{ fontSize: 13, color: '#b91c1c' }}>Failed: {aiOppsError}</div>}
        {aiOpps && (
          <>
            <div style={{ fontSize: 13.5, marginBottom: 16 }}>
              <strong>{aiOpps.aiRelatedCount.toLocaleString()}</strong> of <strong>{aiOpps.totalJobsInWindow.toLocaleString()}</strong> jobs posted in the last {aiOpps.windowDays} days ({aiOpps.aiSharePct}%) are AI-related roles.
            </div>

            <div style={{ fontWeight: 700, fontSize: 12, margin: '14px 0 6px' }}>Most in-demand skills</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {aiOpps.topSkills.map(s => (
                <li key={s.skill} style={{ marginBottom: 6, fontSize: 12.5, color: '#334155' }}>
                  <div>{s.skill} ({s.count} postings)</div>
                  <CertLinks certifications={s.certifications} />
                </li>
              ))}
            </ul>

            <div style={{ fontWeight: 700, fontSize: 12, margin: '14px 0 6px' }}>Top titles</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {aiOpps.topTitles.map(t => (
                <li key={t.title} style={{ marginBottom: 4, fontSize: 12.5, color: '#334155' }}>{t.title} ({t.count})</li>
              ))}
            </ul>

            <div style={{ fontWeight: 700, fontSize: 12, margin: '14px 0 6px' }}>Top hiring companies</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {aiOpps.topCompanies.map(c => (
                <li key={c.company} style={{ marginBottom: 4, fontSize: 12.5, color: '#334155' }}>{c.company} ({c.count})</li>
              ))}
            </ul>
          </>
        )}
      </div>

    </div>
  );
}
