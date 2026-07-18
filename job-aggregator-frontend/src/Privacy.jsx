export default function Privacy() {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '60px 24px 120px', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif', lineHeight: 1.7 }}>
      <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 8, color: '#f8fafc' }}>Privacy Policy</h1>
      <p style={{ color: '#64748b', marginBottom: 40 }}>Last updated: July 2026</p>

      <section style={{ marginBottom: 36 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: '#f8fafc', marginBottom: 12 }}>What SimplyApply Does</h2>
        <p>SimplyApply is a Chrome extension that autofills job application forms using your saved profile. The companion website at simplyappl.ai lets you browse job listings and track your applications.</p>
      </section>

      <section style={{ marginBottom: 36 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: '#f8fafc', marginBottom: 12 }}>Data We Collect</h2>
        <p style={{ marginBottom: 12 }}><strong style={{ color: '#f8fafc' }}>Profile data</strong> — Name, email, phone number, LinkedIn URL, GitHub URL, city, state, education, work authorization status, and salary expectation. This is entered by you in the extension's options page and stored locally in your browser. It is sent to our servers only when you save your profile or use the AI answer feature.</p>
        <p style={{ marginBottom: 12 }}><strong style={{ color: '#f8fafc' }}>Authentication data</strong> — If you create an account, we store your email address and a hashed password via Supabase. A session token is stored as a cookie to keep you signed in.</p>
        <p><strong style={{ color: '#f8fafc' }}>Application tracking data</strong> — When you autofill a job application, we record the job URL, job title, company name, and which fields were filled. This is tied to your account so you can view your application history.</p>
      </section>

      <section style={{ marginBottom: 36 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: '#f8fafc', marginBottom: 12 }}>Data We Do Not Collect</h2>
        <p>We do not collect browsing history, keystrokes, page content outside of job application fields, financial information, health information, or personal communications.</p>
      </section>

      <section style={{ marginBottom: 36 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: '#f8fafc', marginBottom: 12 }}>How We Use Your Data</h2>
        <ul style={{ paddingLeft: 20 }}>
          <li style={{ marginBottom: 8 }}>To fill job application forms on your behalf</li>
          <li style={{ marginBottom: 8 }}>To generate AI-written answers to open-ended application questions</li>
          <li style={{ marginBottom: 8 }}>To show you your application history on simplyappl.ai</li>
          <li>To personalize the job listings shown to you based on your skills and past applications</li>
        </ul>
      </section>

      <section style={{ marginBottom: 36 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: '#f8fafc', marginBottom: 12 }}>Data Sharing</h2>
        <p>We do not sell, rent, or share your personal data with third parties. We use Supabase (database and authentication) and Anthropic (AI answers). These are sub-processors that handle data only as needed to provide the service.</p>
      </section>

      <section style={{ marginBottom: 36 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: '#f8fafc', marginBottom: 12 }}>Data Retention & Deletion</h2>
        <p>Your profile is stored locally in your browser and on our servers while your account is active. You can delete your account and all associated data by emailing <a href="mailto:support@simplyappl.ai" style={{ color: '#3b82f6' }}>support@simplyappl.ai</a>.</p>
      </section>

      <section style={{ marginBottom: 36 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: '#f8fafc', marginBottom: 12 }}>Contact</h2>
        <p>Questions about this policy: <a href="mailto:support@simplyappl.ai" style={{ color: '#3b82f6' }}>support@simplyappl.ai</a></p>
      </section>
    </div>
  );
}
