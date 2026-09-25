import React, { useEffect } from 'react';

const SUPPORT = 'support@simplyappl.ai';
const h2 = { fontSize: 18, fontWeight: 600, color: '#f8fafc', marginBottom: 12 };
const section = { marginBottom: 36 };
const strong = { color: '#f8fafc' };
const link = { color: '#60a5fa' };
const item = { marginBottom: 8 };

export default function Privacy() {
  useEffect(() => { document.title = 'SimplyApply Privacy Policy'; }, []);

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '60px 24px 120px', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif', lineHeight: 1.7 }}>
        <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 8, color: '#f8fafc' }}>Privacy Policy</h1>
        <p style={{ color: '#94a3b8', marginBottom: 40 }}>Last updated: September 2026</p>

        <section style={section}>
          <h2 style={h2}>What SimplyApply is</h2>
          <p>
            SimplyApply helps you find jobs and apply to them. It has three parts that share one account: the SimplyApply app
            for Android, the website at simplyappl.ai, and the{' '}
            <a href="https://chromewebstore.google.com/detail/simplyapply-%E2%80%94-ai-job-auto/ocdeebjeffdjmfgmclnlphkhfdcdpdkf" style={link}>SimplyApply Chrome extension</a>,
            which fills in job application forms using your saved profile. This policy covers all three.
          </p>
        </section>

        <section style={section}>
          <h2 style={h2}>Data we collect</h2>
          <p style={item}><strong style={strong}>Account data</strong> — Your email address and a password. Passwords are stored only in hashed form by our authentication provider, Supabase. We also keep an internal account ID. You can browse jobs without an account.</p>
          <p style={item}><strong style={strong}>Profile and resume</strong> — Details you choose to add: your name, phone number, country, education, whether you need visa sponsorship, and your resume text. In the app you can choose a resume PDF; it is read on your phone, you review the text, and only the text you save is sent to our servers. The PDF file itself is not uploaded. The extension can also store details such as your city, LinkedIn and GitHub links and salary expectation.</p>
          <p style={item}><strong style={strong}>Job preferences</strong> — Keywords, location, minimum salary, and companies, job titles or places you want excluded. We use them to shape the jobs shown to you.</p>
          <p style={item}><strong style={strong}>Activity in the product</strong> — Jobs you shortlist, search terms you use while signed in, skill check results, and the fit checks you run.</p>
          <p style={item}><strong style={strong}>Fit checks and skills</strong> — When you tap "Check my fit", we record the job's link and title and which skills matched or were missing, so we can build your "Skills you're missing" list. We also count how many AI checks you have used, because each account has a usage limit.</p>
          <p style={item}><strong style={strong}>Application tracking (extension)</strong> — When you use the extension to fill in an application, we record the job link, title, company and which fields were filled, so you can see your history on simplyappl.ai.</p>
          <p><strong style={strong}>Technical data</strong> — Like most services, our servers log requests (for example IP address, time and the page or API called) for security and troubleshooting. The website also records basic usage events, such as completing sign-up.</p>
        </section>

        <section style={section}>
          <h2 style={h2}>Data we do not collect</h2>
          <p>
            The app does not use your location, contacts, photos, microphone or advertising ID, and it contains no ads or advertising
            trackers. The extension does not collect your browsing history, keystrokes, or page content outside job application forms.
            We do not collect financial or health information.
          </p>
        </section>

        <section style={section}>
          <h2 style={h2}>How we use your data</h2>
          <ul style={{ paddingLeft: 20 }}>
            <li style={item}>To create and secure your account and keep you signed in</li>
            <li style={item}>To show jobs, your shortlist and your preferences across the app, the website and the extension</li>
            <li style={item}>To personalize the job listings shown to you</li>
            <li style={item}>To run the fit checks, skill checks and skills-gap features you ask for, including AI-written assessments and answers</li>
            <li style={item}>To fill in job application forms on your behalf (extension)</li>
            <li>To keep the service secure, fix problems and prevent abuse</li>
          </ul>
        </section>

        <section style={section}>
          <h2 style={h2}>Services that process data for us</h2>
          <p style={item}>We use a small number of providers who handle data only as needed to run SimplyApply, and only on our instructions:</p>
          <ul style={{ paddingLeft: 20 }}>
            <li style={item}><strong style={strong}>Supabase</strong> — database and sign-in.</li>
            <li style={item}><strong style={strong}>Fly.io</strong> — hosting for our servers and website.</li>
            <li style={item}><strong style={strong}>Anthropic</strong> — the AI provider that writes fit-check summaries, skill check questions and application answers. For a fit check, our server sends it the text of the job, its title and link, and parts of your saved profile (your country, work-authorization answer, education and an excerpt of your resume). It does not receive your email address or phone number.</li>
            <li><strong style={strong}>Google</strong> — the app loads company logos from Google's favicon service, which tells Google the company's website address and, like any web request, your IP address.</li>
          </ul>
          <p style={{ marginTop: 12 }}>
            When you tap "Apply on company site", you leave SimplyApply and go to the employer's own website, which has its own privacy policy.
          </p>
        </section>

        <section style={section}>
          <h2 style={h2}>Data sharing</h2>
          <p>We do not sell or rent your personal data, and we do not share it with third parties for their own purposes or for advertising. It goes only to the providers listed above so they can run the service for us.</p>
        </section>

        <section style={section}>
          <h2 style={h2}>How we protect your data</h2>
          <p>Data moves between the app, the website and our servers over encrypted connections (HTTPS). Passwords are hashed. Access to our databases is limited to the people and systems that need it.</p>
        </section>

        <section style={section}>
          <h2 style={h2}>Retention and deletion</h2>
          <p>
            We keep your data while your account is active. You can ask us to delete your account and the data linked to it at any time, from
            Account → Delete account in the app, or on our <a href="/delete-account" style={link}>delete-account page</a>, which explains what is
            deleted and how long it takes. You can also email <a href={`mailto:${SUPPORT}`} style={link}>{SUPPORT}</a>. You can remove
            shortlisted jobs yourself in the app at any time. If you use the extension, it also keeps a copy of your profile in your own
            browser; uninstalling the extension removes that copy.
          </p>
        </section>

        <section style={section}>
          <h2 style={h2}>Children</h2>
          <p>SimplyApply is for people looking for work and is not directed at children under 16. We do not knowingly collect their data.</p>
        </section>

        <section style={section}>
          <h2 style={h2}>Changes to this policy</h2>
          <p>If we change this policy in a way that matters, we will update the date above and, where appropriate, tell you in the app or by email.</p>
        </section>

        <section style={section}>
          <h2 style={h2}>Contact</h2>
          <p>Questions about this policy or your data: <a href={`mailto:${SUPPORT}`} style={link}>{SUPPORT}</a></p>
        </section>
      </div>
    </div>
  );
}
