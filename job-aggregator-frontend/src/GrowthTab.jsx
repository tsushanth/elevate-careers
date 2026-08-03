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

// A clickable term that searches the Jobs tab for it — used for skills and
// titles, where "clicking" means "show me jobs matching this."
function TermButton({ term, onClick, children }) {
  return (
    <button
      type="button"
      onClick={() => onClick(term)}
      title={`Search jobs for "${term}"`}
      style={{
        all: 'unset', cursor: 'pointer', color: '#0f172a', fontWeight: 600,
        borderBottom: '1px dashed #94a3b8',
      }}
    >
      {children}
    </button>
  );
}

const btnStyle = {
  fontSize: 11.5, fontWeight: 600, padding: '3px 10px', borderRadius: 6,
  border: '1px solid #e2e8f0', background: '#fafafa', color: '#0f172a', cursor: 'pointer',
};

// Skill Check quiz modal — deliberately never called a "certification" (see
// the migration's header comment): this is a SimplyApply-internal
// assessment, not an industry credential, and the UI should never blur that
// line for a candidate who might put it on a resume.
function SkillCheckModal({ skill, session, API_URL, onClose, onPassed }) {
  const [quiz, setQuiz] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [answers, setAnswers] = useState([]);
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/api/ai-resume/skills/check?skill=${encodeURIComponent(skill)}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.message || data.error);
        setQuiz(data);
        setAnswers(new Array(data.questions.length).fill(null));
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [skill, session, API_URL]);

  const submit = async () => {
    setSubmitting(true);
    try {
      const r = await fetch(`${API_URL}/api/ai-resume/skills/check/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ skill, answers }),
      });
      const data = await r.json();
      if (data.error) throw new Error(data.message || data.error);
      setResult(data);
      if (data.passed) onPassed(skill);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const allAnswered = answers.length > 0 && answers.every(a => a !== null);

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }} onClick={onClose}>
      <div style={{
        background: '#fff', borderRadius: 14, padding: 28, maxWidth: 560, width: '100%',
        maxHeight: '85vh', overflowY: 'auto',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Skill Check: {skill}</div>
          <button type="button" onClick={onClose} style={{ all: 'unset', cursor: 'pointer', fontSize: 18, color: '#94a3b8' }}>✕</button>
        </div>
        <div style={{ fontSize: 11.5, color: '#94a3b8', marginBottom: 18 }}>
          A SimplyApply Skill Check — an internal assessment, not an industry certification.
        </div>

        {loading && <div style={{ fontSize: 13, color: '#94a3b8' }}>Loading questions…</div>}
        {error && <div style={{ fontSize: 13, color: '#b91c1c' }}>Failed: {error}</div>}

        {quiz && !result && (
          <>
            {quiz.questions.map((q, qi) => (
              <div key={qi} style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 8 }}>{qi + 1}. {q.question}</div>
                {q.options.map((opt, oi) => (
                  <label key={oi} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 6, cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name={`q${qi}`}
                      checked={answers[qi] === oi}
                      onChange={() => setAnswers(prev => prev.map((a, i) => i === qi ? oi : a))}
                    />
                    {opt}
                  </label>
                ))}
              </div>
            ))}
            <button
              type="button"
              disabled={!allAnswered || submitting}
              onClick={submit}
              style={{
                ...btnStyle, background: '#0f172a', color: '#fff', padding: '8px 18px', fontSize: 13,
                opacity: (!allAnswered || submitting) ? 0.5 : 1,
              }}
            >
              {submitting ? 'Grading…' : 'Submit'}
            </button>
          </>
        )}

        {result && (
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: result.passed ? '#16a34a' : '#b91c1c', marginBottom: 6 }}>
              {result.passed ? '✅ Passed' : '❌ Not yet'} — {result.score}/{result.total} (need {result.passingScore}/{result.total})
            </div>
            {result.passed && result.unlocksJobs?.length > 0 && (
              <div style={{ marginTop: 12, fontSize: 13 }}>
                🔓 You unlocked {result.unlocksJobs.length} job{result.unlocksJobs.length > 1 ? 's' : ''} that needed this:
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {result.unlocksJobs.map(j => (
                    <li key={j.url} style={{ marginBottom: 4 }}>
                      <a href={j.url} target="_blank" rel="noopener noreferrer" style={{ color: '#16a34a' }}>{j.title}</a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!result.passed && (
              <div style={{ fontSize: 13, color: '#64748b', marginTop: 6 }}>Review the skill and try again anytime.</div>
            )}
            <button type="button" onClick={onClose} style={{ ...btnStyle, marginTop: 16 }}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function GrowthTab({ session, API_URL, onSearchTerm, onCompanyClick }) {
  const [gapPath, setGapPath] = useState(null);
  const [gapPathLoading, setGapPathLoading] = useState(true);
  const [gapPathError, setGapPathError] = useState(null);

  const [aiOpps, setAiOpps] = useState(null);
  const [aiOppsLoading, setAiOppsLoading] = useState(true);
  const [aiOppsError, setAiOppsError] = useState(null);

  const [verifiedSkills, setVerifiedSkills] = useState(new Set());
  const [activeQuizSkill, setActiveQuizSkill] = useState(null);

  const loadVerified = () => {
    if (!session) return;
    fetch(`${API_URL}/api/ai-resume/skills/verified`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(r => r.json())
      .then(data => setVerifiedSkills(new Set((data.verified || []).map(v => v.skill))))
      .catch(() => {});
  };

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

    loadVerified();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <TermButton term={s.skill} onClick={onSearchTerm}>{s.skill}</TermButton>
                      <span>{s.missingInPct != null ? `— missing in ${s.missingInPct}% of jobs seen` : ''}</span>
                      {verifiedSkills.has(s.skill) ? (
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#16a34a' }}>✓ Verified</span>
                      ) : (
                        <button type="button" onClick={() => setActiveQuizSkill(s.skill)} style={btnStyle}>Take Skill Check</button>
                      )}
                    </div>
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
                  <div><TermButton term={s.skill} onClick={onSearchTerm}>{s.skill}</TermButton> ({s.count} postings)</div>
                  <CertLinks certifications={s.certifications} />
                </li>
              ))}
            </ul>

            <div style={{ fontWeight: 700, fontSize: 12, margin: '14px 0 6px' }}>Top titles</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {aiOpps.topTitles.map(t => (
                <li key={t.title} style={{ marginBottom: 4, fontSize: 12.5, color: '#334155' }}>
                  <TermButton term={t.title} onClick={onSearchTerm}>{t.title}</TermButton> ({t.count})
                </li>
              ))}
            </ul>

            <div style={{ fontWeight: 700, fontSize: 12, margin: '14px 0 6px' }}>Top hiring companies</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {aiOpps.topCompanies.map(c => (
                <li key={c.company} style={{ marginBottom: 4, fontSize: 12.5, color: '#334155' }}>
                  <TermButton term={c.company} onClick={onCompanyClick}>{c.company}</TermButton> ({c.count})
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {activeQuizSkill && (
        <SkillCheckModal
          skill={activeQuizSkill}
          session={session}
          API_URL={API_URL}
          onClose={() => setActiveQuizSkill(null)}
          onPassed={skill => setVerifiedSkills(prev => new Set(prev).add(skill))}
        />
      )}

    </div>
  );
}
