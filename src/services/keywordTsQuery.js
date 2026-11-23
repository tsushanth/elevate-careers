// Builds a to_tsquery('english', ...) string from user-supplied keyword phrases.
//
// Explicit preference keywords are free text ("Software Engineer", "front-end", "C++"). Fed raw into
// to_tsquery they raise `syntax error in tsquery` as soon as one phrase holds a space, which turned
// GET /api/preferences/suggested into a 500 for every user with a multi-word keyword. Each phrase is
// reduced to alphanumeric words joined with the phrase operator (adjacent, in order), and phrases are
// OR-ed, matching how /jobs/personalized builds its query.
export function keywordsToTsQuery(keywords) {
  const phrases = (Array.isArray(keywords) ? keywords : [])
    .filter(k => typeof k === 'string')
    .map(phrase => phrase.trim().split(/[\s,]+/)
      .map(w => w.replace(/[^a-z0-9]/gi, ''))
      .filter(Boolean)
      .join(' <-> '))
    .filter(Boolean);
  return [...new Set(phrases)].join(' | ');
}
