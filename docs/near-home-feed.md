# Near-home-first feed (FEED_NEAR)

`GET /v2/jobs/feed?country=US` can put jobs near the user first, then everything else, in one paginated list.
Code: `src/services/nearHome.js` (who/where), `src/services/geoip.js` (IP -> region), `src/services/feedQuery.js`
(`buildNearQuery`, cursor, cache key), `src/routes/feed-core.js` (plumbing). Off by default.

## Rules
- Only a COUNTRY-level list (no region, no city) for a country that has region codes (US, CA), not `remote=true`, not a keyword (`q`) search. State and city lists are unchanged.
- Tier 0 = jobs whose country-primary row is in the user's home region(s) + the country's remote jobs. Tier 1 = every other row, including `region_code = ''`. Nothing is hidden. Inside a tier the order is the usual `coalesce(feed_at, sort_at) desc, job_id desc`; role / profile / preference / exclusion filters apply to both tiers. The count is unchanged.
- A job is placed by its country-primary row (`is_country_primary`): a job listed in NY and CA whose primary location is NY is tier 1 for a California visitor (it still appears in the California state list).
- Home source, first match wins: `profile` (signed-in `apply_preferences.location`, free text resolved with `places.js`; must name a region of the requested country) > `ip` (DB-IP table, must resolve to the requested country AND a state) > `tz` (`?tz=` IANA zone -> the states of that zone, a coarse set) > none. An IP that resolves to another country ends the ladder with no tiering (a German IP with a New York clock is more likely a VPN). `?near=off` disables it for the request.
- Never GPS. The client IP (`fly-client-ip`, first value, else `req.ip`) is looked up in memory per request and is not stored, cached, put in a cache key or logged by this code. NOTE: the existing `pinoHttp({ logger })` in `src/api/server.js` logs all request headers and `remoteAddress`, so `fly-client-ip` is in the request logs already, for every route, independent of this feature.

## API
- Request: `near=off`, `tz=<IANA zone>` (validated by `/^[A-Za-z_]+\/[A-Za-z_\/+-]+$/` and a table; anything else ignored).
- Response gains `near: { source: 'profile'|'ip'|'tz', regions: ['CA'], label: 'California' }` only when tiering applied. Tiered responses carry `Cache-Control: private, no-cache`.
- Cursor: `[tier, key, id, mode, sig]` (`sig` = sorted home regions). A cursor from another home, a plain cursor while tiering is active, or a tiered cursor while it is not -> `409 {error:'cursor expired', restart:true}`.
- Cache: key includes the sorted region set; `profile` homes bypass the shared cache (`X-Cache: BYPASS`). The warmer warms only the default (no home) pages.
- Kill switch: `FEED_NEAR=on` enables it, anything else is off; it also needs `FEED_ORDER=feed_at`. Off = no tiers, no `near`, `near`/`tz` ignored, no IP lookup.

## Query (buildNearQuery)
Three ordered, individually LIMITed arms, `UNION ALL`ed, then `ORDER BY tier, key, id LIMIT n+1` over the few arm rows:
A) home region(s): one LATERAL probe per region on `idx_feed_region_fa` (more than 8 regions: one walk of `idx_feed_country_fa` with `region_code = ANY(homes)`);
B) remote rows outside the home: `idx_feed_country_remote_fa` (new, `supabase/manual/20261013000100_*`);
C) everything else: `idx_feed_country_fa`, `NOT remote AND region_code <> ALL(homes)`.
The arms partition the scope, so no row is returned twice. A tier-0 cursor continues A+B (C from the top); a tier-1 cursor only C.
Check with `FEED_ORDER=feed_at node scripts/explain-feed.js` (the "near" scenarios).

## Geo-IP data
`src/data/geoip-regions.bin.gz` is built by `scripts/build-geoip.js` from DB-IP "IP to City Lite" (CC BY 4.0). It keeps US and CA with state/province, everything else collapses to `XX`; adjacent identical ranges are merged (IPv6 keyed by the upper 64 bits). Refresh when you like (DB-IP publishes monthly):

    node scripts/build-geoip.js 2026-11          # downloads dbip-city-lite-2026-11.csv.gz, builds, sanity-checks, replaces the file

then run the tests and commit the new file (~5 MB per refresh in git history; the file is loaded lazily on the first lookup and `GEOIP_FILE` missing/corrupt only means the tz fallback and one warning).

Attribution (CC BY 4.0 requires it where results of the database are used): a visible link, exact text `IP Geolocation by DB-IP`, href `https://db-ip.com`, e.g. in the footer / Privacy page.
