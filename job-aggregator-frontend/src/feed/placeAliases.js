// The suggest API only matches the start of a place name, so typed codes ("NY", "UK")
// find nothing useful. expandPlaceQuery turns a code into the full name(s) to ask the
// API for; the input keeps showing what the user typed.

const US_STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

const CA_PROVINCES = {
  AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick', NL: 'Newfoundland and Labrador',
  NS: 'Nova Scotia', NT: 'Northwest Territories', NU: 'Nunavut', ON: 'Ontario', PE: 'Prince Edward Island',
  QC: 'Quebec', SK: 'Saskatchewan', YT: 'Yukon',
};

// Country codes and common aliases. Keys are normalized (uppercase, no dots/spaces).
const COUNTRIES = {
  US: 'United States', USA: 'United States', UK: 'United Kingdom', GB: 'United Kingdom', GBR: 'United Kingdom',
  UAE: 'United Arab Emirates', AE: 'United Arab Emirates', CA: 'Canada', CAN: 'Canada', IE: 'Ireland',
  IN: 'India', AU: 'Australia', NZ: 'New Zealand', DE: 'Germany', FR: 'France', ES: 'Spain', NL: 'Netherlands',
  SG: 'Singapore', JP: 'Japan', BR: 'Brazil', MX: 'Mexico',
};

// Codes that are only a country alias (never a state or province): expand to that country alone.
// Codes shared with a US state or CA province expand to every reading so "CA" offers California and Canada.
export function expandPlaceQuery(term) {
  const raw = (term || '').trim();
  if (!raw || raw.length > 7 || !/^[A-Za-z][A-Za-z. ]*$/.test(raw)) return [raw];
  const key = raw.replace(/[. ]/g, '').toUpperCase();
  if (key.length < 2 || key.length > 3) return [raw];
  const out = [];
  for (const name of [US_STATES[key], CA_PROVINCES[key], COUNTRIES[key]]) {
    if (name && !out.includes(name)) out.push(name);
  }
  // Dotted forms ("U.S.", "U.K.") are country aliases only.
  if (raw.includes('.') && COUNTRIES[key]) return [COUNTRIES[key]];
  return out.length ? out : [raw];
}
