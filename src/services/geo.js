// Shared country/region/city name lookups, used both to parse a bare
// (no-comma) location string into a real country/region/city — instead of
// it silently landing in `city` with country left null — and as a second,
// title-text-based non-US signal in the personalized feed filter. Single
// source of truth so the checks can't drift apart.
//
// Deliberately NOT exhaustive: curated from real production data (the
// highest-volume unmatched city/country strings in job_location) plus a
// reasonable set of other common non-US tech hubs, not a full geo database.
// False negatives (a real non-US location this list doesn't recognize) just
// fall back to today's permissive "no clear signal" behavior — no worse
// than before. False positives (misclassifying something as non-US) are the
// risk to watch for, so keep entries to unambiguous names only (see the
// Georgia note below for the kind of collision to avoid).

// Every recognized phrasing for a country -> one canonical display value,
// so job_location.country only ever holds a consistent form regardless of
// which synonym a given ATS listing used ("UK" vs "United Kingdom" both ->
// "UK"; "USA"/"US"/"United States" all -> "United States").
const COUNTRY_SYNONYMS = {
  canada: 'Canada', mexico: 'Mexico', brazil: 'Brazil', colombia: 'Colombia',
  argentina: 'Argentina', chile: 'Chile', peru: 'Peru', uruguay: 'Uruguay',
  guatemala: 'Guatemala', 'costa rica': 'Costa Rica', panama: 'Panama',
  ecuador: 'Ecuador', bolivia: 'Bolivia', 'dominican republic': 'Dominican Republic',
  honduras: 'Honduras', 'el salvador': 'El Salvador', nicaragua: 'Nicaragua', paraguay: 'Paraguay',
  india: 'India', china: 'China', japan: 'Japan',
  'south korea': 'South Korea', korea: 'South Korea',
  singapore: 'Singapore', vietnam: 'Vietnam', thailand: 'Thailand',
  philippines: 'Philippines', indonesia: 'Indonesia', malaysia: 'Malaysia',
  taiwan: 'Taiwan', 'hong kong': 'Hong Kong', pakistan: 'Pakistan',
  bangladesh: 'Bangladesh', 'sri lanka': 'Sri Lanka',
  'united kingdom': 'UK', uk: 'UK',
  ireland: 'Ireland', germany: 'Germany', france: 'France', spain: 'Spain', italy: 'Italy',
  netherlands: 'Netherlands', poland: 'Poland', portugal: 'Portugal', sweden: 'Sweden',
  norway: 'Norway', denmark: 'Denmark', finland: 'Finland', switzerland: 'Switzerland',
  austria: 'Austria', belgium: 'Belgium', 'czech republic': 'Czech Republic', romania: 'Romania',
  ukraine: 'Ukraine', greece: 'Greece', hungary: 'Hungary', serbia: 'Serbia',
  croatia: 'Croatia', bulgaria: 'Bulgaria', israel: 'Israel', turkey: 'Turkey',
  uae: 'UAE', 'united arab emirates': 'UAE', 'saudi arabia': 'Saudi Arabia', qatar: 'Qatar',
  egypt: 'Egypt', 'south africa': 'South Africa', nigeria: 'Nigeria', kenya: 'Kenya',
  australia: 'Australia', 'new zealand': 'New Zealand',
  // NOTE: "Georgia" deliberately excluded — collides with the US state
  // (e.g. "Atlanta, Georgia"), which is exactly the false-positive risk to
  // avoid here. Add a country-vs-state disambiguation before re-adding it.
  azerbaijan: 'Azerbaijan', kazakhstan: 'Kazakhstan', russia: 'Russia', cyprus: 'Cyprus',
  moldova: 'Moldova', armenia: 'Armenia', belarus: 'Belarus', slovakia: 'Slovakia',
  slovenia: 'Slovenia', lithuania: 'Lithuania', latvia: 'Latvia', estonia: 'Estonia',
  luxembourg: 'Luxembourg', malta: 'Malta', iceland: 'Iceland',
  'united states': 'United States', usa: 'United States', us: 'United States',
};

export const COUNTRY_NAMES = Object.keys(COUNTRY_SYNONYMS);

// Recruiting-region shorthand — not real countries, map to `region` instead.
const REGION_SYNONYMS = {
  latam: 'LATAM', 'latin america': 'LATAM',
  emea: 'EMEA',
  apac: 'APAC', 'asia pacific': 'APAC',
  dach: 'DACH',
  nordics: 'NORDICS', nordic: 'NORDICS',
  benelux: 'BENELUX',
  anz: 'ANZ', 'australia and new zealand': 'ANZ',
  cee: 'CEE',
  'european union': 'EU', eu: 'EU',
  // Continents — unlike "Global"/"Hybrid"/"Anywhere" these unambiguously
  // exclude the US, so they're safe to treat as a non-US signal.
  asia: 'ASIA', europe: 'EUROPE', africa: 'AFRICA', oceania: 'OCEANIA',
  'south america': 'SOUTH_AMERICA',
};

export const REGION_NAMES = Object.keys(REGION_SYNONYMS);
export const REGION_CODES = [...new Set(Object.values(REGION_SYNONYMS))];

// Non-US city -> country. Seeded from the real top unmatched job_location
// rows in production (counts as of 2026-07-31: London 1768, Paris 731,
// Seoul 679, Bengaluru 500, Berlin 461, São Paulo 438, Toronto/Tokyo 422,
// Bangalore 406, Munich 394, Madrid 344, Amsterdam 305, Sydney 273, and
// dozens more in the 100-300 range), plus other common non-US tech hubs.
// Consolidates the old India-city blocklist that used to live in
// server.js's wantsUS clause (Bengaluru/Bangalore/Mumbai/Hyderabad/Pune/
// Delhi/Chennai/Noida/Gurgaon/Gurugram) into this same general mechanism.
const CITY_COUNTRY = {
  // UK
  london: 'UK', manchester: 'UK', bristol: 'UK', edinburgh: 'UK', glasgow: 'UK', leeds: 'UK',
  birmingham: 'UK', cambridge: 'UK', oxford: 'UK', bracknell: 'UK', reading: 'UK',
  slough: 'UK', leicester: 'UK', sheffield: 'UK', newcastle: 'UK', belfast: 'UK',
  // Ireland
  dublin: 'Ireland', cork: 'Ireland',
  // France
  paris: 'France', lyon: 'France', marseille: 'France', toulouse: 'France',
  // Germany
  berlin: 'Germany', munich: 'Germany', hamburg: 'Germany', frankfurt: 'Germany', cologne: 'Germany',
  stuttgart: 'Germany', dusseldorf: 'Germany', 'düsseldorf': 'Germany', leipzig: 'Germany', bochum: 'Germany',
  // Switzerland
  zurich: 'Switzerland', 'zürich': 'Switzerland', geneva: 'Switzerland', basel: 'Switzerland',
  // Spain / Portugal / Italy
  madrid: 'Spain', barcelona: 'Spain', valencia: 'Spain',
  lisbon: 'Portugal', porto: 'Portugal',
  milan: 'Italy', rome: 'Italy',
  // Netherlands / Belgium
  amsterdam: 'Netherlands', rotterdam: 'Netherlands', 'the hague': 'Netherlands',
  brussels: 'Belgium', antwerp: 'Belgium', bruges: 'Belgium',
  // Nordics
  stockholm: 'Sweden', gothenburg: 'Sweden',
  copenhagen: 'Denmark', helsinki: 'Finland', oslo: 'Norway',
  // Eastern Europe
  warsaw: 'Poland', krakow: 'Poland', 'kraków': 'Poland',
  prague: 'Czech Republic', budapest: 'Hungary', bucharest: 'Romania',
  kyiv: 'Ukraine', kiev: 'Ukraine', lviv: 'Ukraine', minsk: 'Belarus', sofia: 'Bulgaria', belgrade: 'Serbia',
  zagreb: 'Croatia', athens: 'Greece', vienna: 'Austria',
  // Middle East
  'tel aviv': 'Israel', 'tel-aviv': 'Israel', 'kfar saba': 'Israel', jerusalem: 'Israel',
  haifa: 'Israel', 'petah tikva': 'Israel', 'herzliya': 'Israel',
  dubai: 'UAE', 'abu dhabi': 'UAE', doha: 'Qatar',
  riyadh: 'Saudi Arabia', jeddah: 'Saudi Arabia',
  istanbul: 'Turkey', ankara: 'Turkey', cairo: 'Egypt',
  // Africa
  nairobi: 'Kenya', lagos: 'Nigeria', johannesburg: 'South Africa', 'cape town': 'South Africa',
  // India
  bengaluru: 'India', bangalore: 'India', mumbai: 'India', hyderabad: 'India',
  pune: 'India', delhi: 'India', 'new delhi': 'India', chennai: 'India',
  noida: 'India', gurgaon: 'India', gurugram: 'India', kolkata: 'India',
  // China / Taiwan / Hong Kong
  shanghai: 'China', beijing: 'China', shenzhen: 'China', guangzhou: 'China', hangzhou: 'China', chengdu: 'China', suzhou: 'China',
  taipei: 'Taiwan',
  // Japan / Korea
  tokyo: 'Japan', osaka: 'Japan', yokohama: 'Japan',
  seoul: 'South Korea', busan: 'South Korea', pangyo: 'South Korea', incheon: 'South Korea',
  // SE Asia
  singapore: 'Singapore', jakarta: 'Indonesia', manila: 'Philippines',
  'kuala lumpur': 'Malaysia', bangkok: 'Thailand',
  'ho chi minh city': 'Vietnam', hanoi: 'Vietnam',
  // Pakistan / Bangladesh / Sri Lanka
  karachi: 'Pakistan', islamabad: 'Pakistan', lahore: 'Pakistan',
  dhaka: 'Bangladesh', colombo: 'Sri Lanka',
  // Oceania
  sydney: 'Australia', melbourne: 'Australia', brisbane: 'Australia', perth: 'Australia',
  auckland: 'New Zealand', wellington: 'New Zealand',
  // Canada
  toronto: 'Canada', vancouver: 'Canada', montreal: 'Canada', 'montréal': 'Canada',
  ottawa: 'Canada', calgary: 'Canada',
  // Latin America
  'mexico city': 'Mexico', 'sao paulo': 'Brazil', 'são paulo': 'Brazil',
  'rio de janeiro': 'Brazil', 'buenos aires': 'Argentina',
  'bogota': 'Colombia', 'bogotá': 'Colombia', medellin: 'Colombia', 'medellín': 'Colombia',
  santiago: 'Chile', lima: 'Peru', montevideo: 'Uruguay',
  'guatemala city': 'Guatemala', 'santo domingo': 'Dominican Republic',
  quito: 'Ecuador', 'la paz': 'Bolivia', asuncion: 'Paraguay', 'asunción': 'Paraguay',
  // NOTE: "San Jose"/"Panama City" deliberately excluded — collide with
  // real US cities (San Jose, CA; Panama City, FL), same false-positive
  // risk as the Georgia exclusion above.
};

// Matches "India (Remote)", "Remote - Canada", "United States | Remote",
// "US > Arizona > Phoenix" etc. — splits on every separator these ATS
// listings actually use and drops noise tokens that carry no location info.
const SEPARATOR_RE = /[,|>]|(?<=\S)\s*-\s*(?=\S)|[()]/g;
const NOISE_WORDS = ['remote', 'hybrid', 'onsite', 'on-site', 'anywhere', 'global', 'flexible'];
const NOISE_TOKENS = new Set(NOISE_WORDS);
// Catches noise words with no strong separator at all ("US Remote",
// "Canada Remote") — strip as a whole word from within a token, not just
// when it's already its own token.
const NOISE_WORD_RE = new RegExp(`\\b(${NOISE_WORDS.join('|')})\\b`, 'gi');

export function tokenizeLocation(raw) {
  return raw
    .split(SEPARATOR_RE)
    .map(t => t.trim())
    .filter(t => t && !NOISE_TOKENS.has(t.toLowerCase()))
    .map(t => t.replace(NOISE_WORD_RE, '').trim())
    .filter(Boolean);
}

const ACRONYM_DISPLAY = { uk: 'UK', uae: 'UAE' };

function titleCase(s) {
  if (ACRONYM_DISPLAY[s]) return ACRONYM_DISPLAY[s];
  // \b\w only matches ASCII word chars, so "são paulo" broke ("SãO Paulo" —
  // the accented "ã" isn't \w, so \b treated the letter after it as a new
  // word boundary too). \p{L} + explicit start-of-string/after-space is
  // Unicode-correct and only capitalizes the true first letter of each word.
  return s.replace(/(^|\s)\p{L}/gu, c => c.toUpperCase());
}

// Tries a single already-trimmed token against country/region/city lookups.
export function matchCountryOrRegion(rawToken) {
  const cleaned = rawToken.trim().toLowerCase();
  if (!cleaned) return null;
  if (REGION_SYNONYMS[cleaned]) return { type: 'region', value: REGION_SYNONYMS[cleaned] };
  if (COUNTRY_SYNONYMS[cleaned]) return { type: 'country', value: COUNTRY_SYNONYMS[cleaned] };
  if (CITY_COUNTRY[cleaned]) return { type: 'city', value: titleCase(cleaned), country: CITY_COUNTRY[cleaned] };
  return null;
}

// Tokenizes a raw (comma-free) location string and tries each token in
// order, returning the first match. Used by parseLocation's single-token
// branch and by the location backfill script.
export function resolveLocationToken(raw) {
  const tokens = tokenizeLocation(raw);
  for (const token of tokens) {
    const match = matchCountryOrRegion(token);
    if (match) return match;
  }
  return null;
}

// Gendered-hiring suffixes legally required (or near-universal) on job
// titles in certain non-English markets — an unusually reliable, low-
// false-positive-risk non-US signal since these almost never appear in
// English titles by coincidence. "(H/F)"/"(F/H)" = French "Homme/Femme";
// "(M/W/D)"/"(W/M/D)"/"(M/F/D)" = German "Mann/Frau/Divers".
const MARKET_MARKERS = ['h/f', 'f/h', 'm/w/d', 'w/m/d', 'm/f/d', 'f/m/d', 'd/m/w', 'd/f/m'];

// For the title-text signal — a regex alternation of all names, \y-bounded
// (Postgres word-boundary; NOT \b, which is a backspace escape in Postgres's
// POSIX ARE regex dialect, unlike JS — verified directly, see server.js).
// US synonyms are deliberately excluded here — they're the opposite signal
// in a title (an ALLOW, not a non-US marker), plus "uk"/"korea" are too
// short/ambiguous as bare title substrings.
export function nonUsTitleRegex() {
  const names = [...COUNTRY_NAMES, ...REGION_NAMES, ...Object.keys(CITY_COUNTRY), ...MARKET_MARKERS]
    .filter(n => !['uk', 'korea', 'us', 'usa', 'united states'].includes(n))
    .map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return `\\y(${names.join('|')})\\y`;
}
