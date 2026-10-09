# Profile fit ranking (FEED_FIT_RANK)

Inside the signed-in profile list, jobs that match the user's own words rank ahead of jobs that only match through a
role family, and obvious level / management mismatches rank behind. Code: `src/services/roleMatch.js` (`fitRules`,
`mismatchQuery`, `fitFilter`), `src/services/feedQuery.js` (`buildNearQuery`, cursor, cache key), `src/routes/feed-core.js`
(plumbing). Off by default.

## What changes
For a signed-in user with a profile (apply_preferences.keywords, else cleaned user_signals.preferred_titles), on the default
list (no `q`, no `role`, no pills, no `prefs=off`) with a near home (docs/near-home-feed.md), each near tier is split in two
FIT BUCKETS and the order becomes **(tier, bucket, `coalesce(feed_at, sort_at)` desc, `job_id` desc)**:

- **Bucket 0, strong fit**: the title matches one of the user's LITERAL profile phrases (the explicit keywords, or the cleaned
  preferred-title phrases when there are no keywords: `profilePhrases().phrases`, the same phrases the profile match is built
  from) AND is not a level / management mismatch.
- **Bucket 1, broader fit**: everything else in today's profile match: family-expansion matches ("Product Engineer",
  "Forward Deployed Data Engineer", "Director of Engineering") and literal matches that are mismatches.

The set of matched jobs, the count, near tiers, company spread (`feed_at`), hard exclusions (excluded titles / locations),
salary, dismissed and applied jobs are unchanged. Only the order inside a tier changes.

Not bucketed: `role=<slug>` lists, `q` searches, `prefs=off`, anonymous users, and any request without a near home (no
country, FEED_NEAR off, no resolvable home): those keep today's order. FEED_FIT_RANK therefore also needs FEED_NEAR=on,
FEED_ORDER=feed_at and FEED_ROLE_MATCH=on; on its own it changes nothing.

## The mismatch rules (per user, from the user's OWN strings)
The user's strings are `keywords` plus `preferred_titles`, lower-cased and split into whole words (`Sr.` -> `sr`).

| Rule | Active when | Titles that count as a mismatch (whole words in `to_tsvector('simple', title)`) | Label in `match.fit` |
|---|---|---|---|
| (a) level | the strings contain one of `senior`, `sr`, `staff`, `principal`, `lead` | `intern`, `internship`, `junior`, `jr`, `apprentice`, `trainee`, `new grad`, `new graduate`, `entry level` / `entry-level`, `graduate programme` / `graduate program` | `Senior-level roles` |
| (b) individual contributor | the strings contain NONE of `director`, `vp`, `vice president`, `head`, `chief`, `manager` | `director`, `vp`, `vice president`, `head of`, `chief`, `manager` | `Individual contributor roles` |

- No seniority word -> rule (a) is off (an entry-level seeker is never pushed away from entry roles). Any one management word anywhere
  in the profile -> rule (b) is off (a manager is never pushed away from manager roles).
- With no rule active, bucket 0 is just "literal phrase match" and `match.fit` is absent.
- `match.fit` (array of the labels of the active rules) is added to the response `match` object only when bucketing applied and a rule is
  active. The frontend ignores unknown fields.
- Known gaps (vocabulary is deliberately short and exact): "New College Graduate", "Engineer I", "Associate" and "Head Chef" style titles are not
  recognised. When explicit keywords exist, preferred titles are NOT literal phrases (they only feed the level / management rules), so "Senior Machine Learning Engineer" is bucket 1 for an account whose keywords do not name ML.

## How it is expressed
Bucket 0 is one tsquery over `to_tsvector('simple', title)`: `(lit1 | lit2 | ...) & !(mismatch1 | mismatch2 | ...)`, tested with
`ts_match_vq` (the opaque function the profile match already uses). Bucket 1 is `NOT` that, inside the same profile filter. No new index.
Example for the example account (keywords Software Engineer / Full-Stack / Reinforcement Learning, preferred titles with Senior / Staff / Lead):

    (('software' <-> 'engineer':*) | ('full' <-> 'stack') | ('reinforcement' <-> 'learning':*))
      & !(('intern') | ('internship') | ('junior') | ('jr') | ('apprentice') | ('trainee') | ('new' <-> 'grad') | ('new' <-> 'graduate')
        | ('entry' <-> 'level') | ('graduate' <-> ('programme' | 'program')) | ('director') | ('vp') | ('vice' <-> 'president')
        | ('head' <-> 'of') | ('chief') | ('manager'))

## Query shape
`buildNearQuery` makes one arm per (tier, bucket): up to 6 ordered, individually LIMITed arms (tier 0 is one LATERAL probe per home region
for homes of up to 8 regions), `UNION ALL`ed, then `ORDER BY tier, bucket, order_key DESC, id DESC LIMIT n+1`. Every arm still walks its
`feed_at` index (`idx_feed_region_fa`, `idx_feed_country_remote_fa`, `idx_feed_country_fa`) with the bucket test as a filter.
The cursor position is (tier, bucket): arms before it are dropped, the arm it sits in continues after (key, id), later arms start from the top.

Pruning for profiles without a role family (every phrase falls in no family, so the profile match is the literal match): bucket 1 can only hold
literal matches that are mismatches. With no active rule it is provably empty and its arms are not built; with a rule its arms carry a positive
GIN gate (`to_tsvector('simple', title) @@ <mismatch words>`) next to the profile gate, so an almost-empty bucket is a bitmap probe and not a
walk of the whole tier. Profiles that include a family (engineering etc.) have a dense bucket 1 and need no gate. A bucket 0 that is sparse
inside a dense family (a rare keyword next to "Software Engineer"-like families) walks the tier index until 26 hits or the end of the tier; measured below.

## Cursor, cache, kill switch
- Cursor: `[tier, key, id, mode, sig, bucket]` (six elements, bucket 0 | 1). `sig` is `n3f:<regions>` (the unbucketed one is `n3:<regions>`).
  A cursor of the other scheme, a bucket-less cursor on a bucketed list, a bucket on an unbucketed list, a plain cursor while tiered ->
  `409 {error:'cursor expired', restart:true}`, both when the switch is flipped and during a rolling deploy.
- Cache: the key's scheme tag is `n3f` for a bucketed home (`n3` otherwise). Signed-in profile responses bypass the shared and L1 caches
  (`X-Cache: BYPASS`) and carry `Cache-Control: private, no-cache`, as before.
- A user who edits their keywords mid-pagination continues with the new rules against the old cursor position (the same weakness the profile
  match itself has); the next restart is clean.
- Kill switch: `FEED_FIT_RANK=on` (also `1`, `true`) enables it, anything else is off. Off = single bucket, today's SQL, 5-element cursors, `n3`,
  no `match.fit`. Read per call, so flipping needs no code change (restart the process or `fly secrets set`).

## Check
`FEED_ORDER=feed_at node scripts/explain-feed.js` has the "fit" scenarios: home CA / home TX / tz Pacific, profile with and without a seniority
signal, a sparse literal in a dense family, a rare literal without a family; first page, deep bucket 0, bucket 0 -> 1, tier 0 -> 1 and 1 -> 2
crossings, deep tier 2. Each must stay under 150 ms DB time, with no Seq Scan on job_feed and no Sort besides the outer one.
Tests: `src/routes/feed-core.fit.test.js` (oracle over page sizes 1, 7, 25, 50), `src/services/roleMatch.test.js`, `feedQuery.test.js`,
`roleMatch.pg.test.js` (needs TEST_DATABASE_URL).
