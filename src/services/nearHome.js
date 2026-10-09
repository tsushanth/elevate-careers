// "Near home first" for the home feed: on a COUNTRY-level list three tiers in one paginated list:
// 0 = jobs tagged to the user's home region (state or province; on-site, hybrid and remote), 1 = remote jobs
// open to the whole country (no state tag), 2 = everything else (incl. remote jobs tagged to another state). Nothing is hidden. This module decides WHETHER and WHERE the user's home is; the SQL is in
// feedQuery.js (buildNearQuery) and the plumbing in routes/feed-core.js.
//
// Home source priority (first that yields a region in the requested country wins):
//   1. 'profile'  the signed-in user's saved apply_preferences.location ("San Francisco, CA")
//   2. 'ip'       the client IP looked up in the in-memory DB-IP table (geoip.js); never stored or logged
//   3. 'tz'       the browser's IANA time zone (?tz=) -> the states of that zone, a COARSE fallback
//   none          no tiering, the response has no `near`
// The IP is only used when it resolves to the requested country. An IP that resolves to ANOTHER country
// (or to a country we have no regions for) ends the ladder without tiering: a German IP with an
// America/New_York clock is more likely a VPN than a New Yorker, and the safe default is the plain list.
//
// Kill switch: FEED_NEAR=on enables it (default off). It also needs FEED_ORDER=feed_at, the ordering the
// supporting indexes are built for. Off means nothing changes: no tiers, no `near`, `near`/`tz` params ignored.
import { US_STATES, CA_PROVINCES, normalizeLocationRow } from './places.js';
import { geoip as defaultGeoip } from './geoip.js';
import { feedOrderMode, NEAR_SCHEME, NEAR_SCHEME_FIT } from './feedQuery.js';

export const nearEnabled = (env = process.env) => env.FEED_NEAR === 'on' && feedOrderMode(env) === 'feed_at';

const REGION_NAMES = { US: US_STATES, CA: CA_PROVINCES };

// Only for a plain country-level list that is not already narrowed to remote jobs (then there is no
// tier to build) or to a keyword search (relevance-style, not location-style).
export function nearApplicable(p) {
  return !!(p.country && !p.region && !p.city && !p.remote && !p.q && REGION_NAMES[p.country]);
}

// ---- time zone fallback -------------------------------------------------------------------------
// IANA zone -> [country, regions, label]. A multi-region zone makes every listed region tier 0.
// The sets are deliberately coarse (a zone is not a state): they decide "roughly your part of the
// country", they are never shown as the user's state. Zones not listed (Europe/..., Asia/...) give no home.
const PACIFIC = ['CA', 'OR', 'WA', 'NV'];
const MOUNTAIN = ['CO', 'UT', 'NM', 'WY', 'MT', 'ID', 'AZ'];                 // AZ: Phoenix-time users also match America/Denver in summer
const CENTRAL = ['TX', 'OK', 'KS', 'NE', 'SD', 'ND', 'MN', 'IA', 'MO', 'AR', 'LA', 'MS', 'AL', 'WI', 'IL', 'TN'];
const EASTERN = ['ME', 'NH', 'VT', 'MA', 'RI', 'CT', 'NY', 'NJ', 'PA', 'DE', 'MD', 'DC', 'VA', 'WV', 'NC', 'SC', 'GA', 'FL', 'OH', 'MI', 'IN', 'KY'];
const Z = {};
const zone = (names, country, regions, label) => { for (const n of names) Z[n] = { country, regions, label }; };
zone(['America/Los_Angeles', 'US/Pacific'], 'US', PACIFIC, 'Pacific time zone states');
zone(['America/Denver', 'America/Boise', 'US/Mountain', 'America/Shiprock'], 'US', MOUNTAIN, 'Mountain time zone states');
zone(['America/Chicago', 'US/Central', 'America/Menominee', 'America/Indiana/Knox', 'America/Indiana/Tell_City', 'America/North_Dakota/Center', 'America/North_Dakota/New_Salem', 'America/North_Dakota/Beulah'], 'US', CENTRAL, 'Central time zone states');
zone(['America/New_York', 'US/Eastern', 'America/Detroit', 'America/Indiana/Indianapolis', 'America/Indiana/Marengo', 'America/Indiana/Vevay', 'America/Indiana/Vincennes', 'America/Indiana/Winamac', 'America/Indiana/Petersburg', 'America/Kentucky/Louisville', 'America/Kentucky/Monticello', 'America/Louisville', 'America/Fort_Wayne', 'America/Indianapolis'], 'US', EASTERN, 'Eastern time zone states');
zone(['America/Phoenix', 'US/Arizona'], 'US', ['AZ'], 'Arizona');
zone(['America/Anchorage', 'America/Juneau', 'America/Sitka', 'America/Nome', 'America/Yakutat', 'America/Metlakatla', 'America/Adak', 'US/Alaska'], 'US', ['AK'], 'Alaska');
zone(['Pacific/Honolulu', 'US/Hawaii'], 'US', ['HI'], 'Hawaii');
zone(['America/Vancouver'], 'CA', ['BC'], 'British Columbia');
zone(['America/Edmonton', 'America/Calgary'], 'CA', ['AB'], 'Alberta');
zone(['America/Winnipeg'], 'CA', ['MB'], 'Manitoba');
zone(['America/Regina'], 'CA', ['SK'], 'Saskatchewan');
zone(['America/Toronto', 'America/Montreal', 'America/Nipigon', 'America/Thunder_Bay'], 'CA', ['ON', 'QC'], 'Ontario and Quebec');
zone(['America/Halifax', 'America/Moncton', 'America/Glace_Bay'], 'CA', ['NS', 'NB', 'PE'], 'Atlantic Canada');
zone(['America/St_Johns'], 'CA', ['NL'], 'Newfoundland and Labrador');
zone(['America/Whitehorse'], 'CA', ['YT'], 'Yukon');
zone(['America/Yellowknife'], 'CA', ['NT'], 'Northwest Territories');
export const TZ_ZONES = Z;

const TZ_RE = /^[A-Za-z_]+\/[A-Za-z_/+-]+$/;
// ?tz= is only a hint: anything malformed or not in the table is ignored.
export function tzHome(tz, country) {
  if (typeof tz !== 'string' || tz.length > 60 || !TZ_RE.test(tz)) return null;
  const z = Object.hasOwn(Z, tz) ? Z[tz] : null;
  return z && z.country === country ? { regions: z.regions, label: z.label } : null;
}

// ---- profile location ---------------------------------------------------------------------------
// apply_preferences.location is free text. places.js resolves it the same way job locations are resolved;
// it counts only when it names a region of the requested country.
export function profileHome(location, country) {
  const text = typeof location === 'string' ? location.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
  if (!text) return null;
  const r = normalizeLocationRow({ city: text, region: '', country: '' });
  if (r.country_code !== country || !r.region_code) return null;
  const name = REGION_NAMES[country]?.[r.region_code];
  return name ? { regions: [r.region_code], label: name } : null;
}

// ---- client address -----------------------------------------------------------------------------
// Fly's edge sets fly-client-ip (overwriting anything the client sent). Falls back to req.ip, which behind
// the Fly proxy is a private address and is then ignored by the lookup. Used in memory for one lookup.
export function clientIp(req) {
  const h = req?.headers?.['fly-client-ip'];
  const first = String(Array.isArray(h) ? h[0] : h || '').split(',')[0].trim();
  return first || req?.ip || '';
}

export function ipHome(ip, country, geo = defaultGeoip) {
  const hit = ip ? geo.lookup(ip) : null;
  if (!hit) return { home: null, foreign: false };
  if (hit.country !== country) return { home: null, foreign: true };
  const name = hit.region && REGION_NAMES[country]?.[hit.region];
  return name ? { home: { regions: [hit.region], label: name }, foreign: false } : { home: null, foreign: false };
}

// The signature of a home: the tier-scheme version plus the sorted region set. Part of the cursor, so a
// cursor minted under another scheme (the old two-tier one had no prefix) is refused with a 409 restart.
export const homeSig = (regions, fit = false) => `${fit ? NEAR_SCHEME_FIT : NEAR_SCHEME}:${[...regions].sort().join(',')}`;

// ladder: profile > ip > tz > none. Returns { source, regions (sorted), label, sig } or null.
export function resolveHome({ country, profileLocation = null, ip = '', tz = '', geo = defaultGeoip }) {
  const done = (source, h) => ({ source, regions: [...h.regions].sort(), label: h.label, sig: homeSig(h.regions) });
  const p = profileHome(profileLocation, country);
  if (p) return done('profile', p);
  const { home, foreign } = ipHome(ip, country, geo);
  if (home) return done('ip', home);
  if (foreign) return null;
  const z = tzHome(tz, country);
  return z ? done('tz', z) : null;
}

// What goes into the response: only when tiering applied.
export const nearPayload = (h) => ({ source: h.source, regions: h.regions, label: h.label });
