// Strips markdown backslash escapes from job descriptions before display.
//
// Descriptions are stored as "markdown" (see normalizer.htmlToMarkdown) but the
// site renders them as HTML, so the escapes turndown/jobspy add ("\*", "\_",
// "\-", "\.", "\&" ...) show up literally. LinkedIn/Indeed text was also
// converted twice, producing "\\&" and "\\*\\*".
//
// Only the punctuation markdown converters escape is unescaped, and one or two
// backslashes are collapsed. "<" and ">" are deliberately excluded: this output
// goes to dangerouslySetInnerHTML, so "\<script>" must never become "<script>".
// Backslash itself is excluded and letters are never touched, so Windows paths
// (C:\Users\me) survive. Code spans, fences and <pre>/<code> are left alone.
//
// KEEP IN SYNC with src/utils/unescapeMarkdown.js (backend copy).
const ESCAPE_RE = /\\{1,2}([`*_{}[\]()#+\-.!&|~])/g;
const PROTECTED_RE = /(<(pre|code)\b[\s\S]*?<\/\2>|```[\s\S]*?```|`[^`\n]*`)/gi;

export function unescapeMarkdown(text) {
  if (typeof text !== 'string' || !text.includes('\\')) return text;
  // split with a capture group: odd-indexed parts are protected segments
  // (plus the inner tag-name capture, so step by the 3-group stride).
  const parts = text.split(PROTECTED_RE);
  let out = '';
  for (let i = 0; i < parts.length; i += 3) {
    out += parts[i].replace(ESCAPE_RE, '$1');
    if (i + 1 < parts.length) out += parts[i + 1];
  }
  return out;
}

export default unescapeMarkdown;
