# Near-home-first feed (FEED_NEAR)

`GET /v2/jobs/feed?country=US` can put jobs near the user first, then everything else, in one paginated list.
Code: `src/services/nearHome.js` (who/where), `src/services/geoip.js` (IP -> region), `src/services/feedQuery.js`
(`buildNearQuery`, cursor, cache key), `src/routes/feed-core.js` (plumbing). Off by default.

## Rules
- Only a COUNTRY-level list (no region, no city) for a country that has region codes (US, CA), not `remote=true`, not a keyword (`q`) search. State and city lists are unchanged.
- Three tiers, by geography (workplace type is separate from location, as on LinkedIn; a remote job carries a location tag: a state, or nothing = the whole country):
  - Tier 0 "in your state" = `region_code` is one of the home region(s), whatever the workplace type (on-site, hybrid, and remote jobs tagged to that state, e.g. "Global Remote / San Francisco").
  - Tier 1 "remote, open to the whole country" = `remote AND region_code = ''`.
  - Tier 2 = everything else: remote jobs tagged to ANOTHER state ("New York / Remote" is not near a Californian), on-site jobs in other states, rows with an unknown state.
  Nothing is hidden. Inside a tier the order is the usual `coalesce(feed_at, sort_at) desc, job_id desc`; role / profile / preference / exclusion filters apply to all tiers. The count is unchanged. For the multi-state tz fallback tier 0 is the union of those states.
- Production sizes (2026-10-08, US, country-primary, active; total 73,439): tier 1 = 4,179 for every home. Tier 0 / tier 2: CA 9,930 / 59,330 (249 of tier 0 remote), TX 5,004 / 64,256 (110), NY 3,855 / 65,405 (152), WA 1,282 / 67,978 (39).
- A job is placed by its country-primary row (`is_country_primary`): a job listed in NY and CA whose primary location is NY is tier 1 for a California visitor (it still appears in the California state list).
- Home source, first match wins: `profile` (signed-in `apply_preferences.location`, free text resolved with `places.js`; must name a region of the requested country) > `ip` (DB-IP table, must resolve to the requested country AND a state) > `tz` (`?tz=` IANA zone -> the states of that zone, a coarse set) > none. An IP that resolves to another country ends the ladder with no tiering (a German IP with a New York clock is more likely a VPN). `?near=off` disables it for the request.
- Never GPS. The client IP (`fly-client-ip`, first value, else `req.ip`) is looked up in memory per request and is not stored, cached, put in a cache key or logged by this code. NOTE: the existing `pinoHttp({ logger })` in `src/api/server.js` logs all request headers and `remoteAddress`, so `fly-client-ip` is in the request logs already, for every route, independent of this feature.

## API
- Request: `near=off`, `tz=<IANA zone>` (validated by `/^[A-Za-z_]+\/[A-Za-z_\/+-]+$/` and a table; anything else ignored).
- Response gains `near: { source: 'profile'|'ip'|'tz', regions: ['CA'], label: 'California' }` only when tiering applied. Tiered responses carry `Cache-Control: private, no-cache`.
- Cursor: `[tier, key, id, mode, sig]` (tier 0 | 1 | 2; `sig` = scheme version + sorted home regions, `n3:CA,OR`). A cursor of the old two-tier scheme has an unprefixed `sig`, so it gets the 409 restart. A cursor from another home, a plain cursor while tiering is active, or a tiered cursor while it is not -> `409 {error:'cursor expired', restart:true}`.
- Cache: key includes the scheme tag `n3` and the sorted region set (the old key had `near`, so a deploy never serves an old-scheme page); `profile` homes bypass the shared cache (`X-Cache: BYPASS`). The warmer warms only the default (no home) pages.
- Kill switch: `FEED_NEAR=on` enables it, anything else is off; it also needs `FEED_ORDER=feed_at`. Off = no tiers, no `near`, `near`/`tz` ignored, no IP lookup.

## Query (buildNearQuery)
Three ordered, individually LIMITed arms, `UNION ALL`ed, then `ORDER BY tier, key, id LIMIT n+1` over the few arm rows:
A) tier 0, home region(s): one LATERAL probe per region on `idx_feed_region_fa` (`is_region_primary AND region_code = home`; more than 8 regions: one walk of `idx_feed_country_fa` with `region_code = ANY(homes)`);
B) tier 1, `remote AND region_code = ''`: `idx_feed_country_remote_fa` (`supabase/manual/20261013000100_*`, unchanged), the `region_code = ''` test is a filter (production: ~24% of the remote index rows are filtered out);
C) tier 2, `region_code <> ALL(homes) AND NOT (remote AND region_code = '')` on `idx_feed_country_fa`. `region_code` and `remote` are NOT NULL in `job_feed`, so the negations are NULL-safe.
The arms partition the scope, so no row is returned twice. A tier-0 cursor continues A (B, C from the top); tier-1 continues B (C from the top); tier-2 only C. No new index.
Check with `FEED_ORDER=feed_at node scripts/explain-feed.js` (the "near" scenarios: first page, deep tier 0/1/2, the 0->1 and 1->2 crossings, with and without a role).

## Profile fit buckets
With FEED_FIT_RANK=on a signed-in profile list is split into two fit buckets inside each tier (cursor gets a sixth element, scheme tag `n3f`). See docs/profile-fit-ranking.md.

## Geo-IP data
`src/data/geoip-regions.bin.gz` is built by `scripts/build-geoip.js` from DB-IP "IP to City Lite" (CC BY 4.0). It keeps US and CA with state/province, everything else collapses to `XX`; adjacent identical ranges are merged (IPv6 keyed by the upper 64 bits). Refresh when you like (DB-IP publishes monthly):

    node scripts/build-geoip.js 2026-11          # downloads dbip-city-lite-2026-11.csv.gz, builds, sanity-checks, replaces the file

then run the tests and commit the new file (~5 MB per refresh in git history; the file is loaded lazily on the first lookup and `GEOIP_FILE` missing/corrupt only means the tz fallback and one warning).

Attribution (CC BY 4.0 requires it where results of the database are used): a visible link, exact text `IP Geolocation by DB-IP`, href `https://db-ip.com`, e.g. in the footer / Privacy page.
