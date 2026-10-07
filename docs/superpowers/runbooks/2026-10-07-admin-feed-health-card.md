# Admin page: home-feed reconciliation card (to apply after `feat/google-signin` merges)

`job-aggregator-frontend/src/Admin.jsx` and the `simplyapply_admin_overview` migration live on the unmerged branch `feat/google-signin`, not on this branch, so this card could not be added here. The SQL function it reads is already in this branch: `supabase/migrations/20261009000000_admin_feed_health.sql` (apply it after the overview migration, which creates `public.simplyapply_admins`).

Apply this to `Admin.jsx` once it is on the branch you are working on (`setData(d); setState('ok');` is at line ~91, a `Card` component and the `useState` calls are at lines ~74-78 on that branch):

1. Beside the other `useState` calls:

```js
const [feedHealth, setFeedHealth] = useState(null);
```

2. After `setData(d); setState('ok');` (an error shows nothing, so a missing function never breaks the page):

```js
supabase
  .rpc('simplyapply_admin_feed_health')
  .then(({ data: fh, error: fe }) => setFeedHealth(fe ? null : (fh || null)))
  .catch(() => setFeedHealth(null));
```

3. Before the closing `</div></div>` of the page:

```jsx
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
```
