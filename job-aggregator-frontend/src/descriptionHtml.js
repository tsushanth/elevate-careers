import DOMPurify from 'dompurify';
import { unescapeMarkdown } from './unescapeMarkdown';

// Job descriptions from some boards (Greenhouse among them) are stored as
// entity-escaped HTML: "&lt;p&gt;Hello&lt;/p&gt;" instead of "<p>Hello</p>".
// Injected as HTML, that renders the tags as literal text. Decode it once when
// the text has escaped tags and no real ones, then sanitize: descriptions are
// third-party content and go to dangerouslySetInnerHTML.
const REAL_TAG_RE = /<[a-z!/][^>]*>/i;
const ESCAPED_TAG_RE = /&lt;\/?[a-z][^&]*?&gt;/i;

function decodeEntitiesOnce(text) {
  const el = document.createElement('textarea');
  el.innerHTML = text;
  return el.value;
}

export function descriptionToSafeHtml(raw) {
  if (typeof raw !== 'string' || raw === '') return '';
  let text = raw;
  if (!REAL_TAG_RE.test(text) && ESCAPED_TAG_RE.test(text)) {
    text = decodeEntitiesOnce(text);
  }
  return DOMPurify.sanitize(unescapeMarkdown(text), { USE_PROFILES: { html: true } });
}

export default descriptionToSafeHtml;
