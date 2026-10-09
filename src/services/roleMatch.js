// Role (job-function) matching for the v2 feed. Pure except resolveFamilies(db, ...).
//
// A "family" is a tsquery over to_tsvector('simple', title) -- the exact expression the
// GIN index idx_feed_title_tsv is built on (supabase/manual/*_job_feed_title_gin.sql).
// Queries are bound as text and cast with $n::tsquery (tsquery input does no
// normalisation, so every lexeme below is written the way the 'simple' config stores it:
// lowercase, no stemming; "Full-Stack" is stored as full-stack + full + stack, "UX/UI" as ux/ui).
//
// Pattern mini-language (space separated tokens, matched as a PHRASE, i.e. adjacent words):
//   word        exact lexeme
//   word*       prefix (engineer* = engineer, engineers, engineering)
//   (a|b c|d)   alternatives; each alternative may itself be a phrase
//   Words may contain '/' for slash-joined titles ("ux/ui" is one lexeme in the tsvector).
// A family is  (OR of its `any` patterns)  AND NOT (OR of its `not` patterns).
// Phrase vetoes are adjacency based, so "Software Engineer, Manufacturing" is not hurt by the
// veto "manufacturing engineer*". Families may overlap by design (an ML engineer is in both
// engineering and data-ml). The macros '@eng' / '@data' (see MACROS) veto titles that read as
// software engineering / data science, so "Software Engineer, Marketing" is not a Marketing job.

const q = (w) => `'${w.replace(/'/g, "''")}'`;
const term = (w) => (w.endsWith('*') ? `${q(w.slice(0, -1))}:*` : q(w));

function phrase(words) {
  const parts = words.map(w => (/\s/.test(w) ? `(${phrase(w.split(/\s+/))})` : term(w)));
  return parts.join(' <-> ');
}

// Words that appear in a large share of all titles: poor GIN anchors. ROLE words (manager, specialist...) are the
// worst; TOPIC words (product, data...) are common but at least say something about the job.
const ROLE_WORDS = new Set(['manager', 'management', 'specialist', 'director', 'lead', 'analyst', 'assistant', 'associate', 'coordinator', 'engineer', 'engineering', 'development',
  'of', 'and', 'senior', 'head', 'vp', 'chief', 'officer', 'executive', 'representative', 'rep', 'reps', 'consultant', 'advisor', 'intern', 'team', 'worker', 'technician', 'professional',
  'agent', 'administrator', 'supervisor', 'owner', 'planner', 'clerk', 'aide', 'program', 'programs', 'operations', 'services', 'service', 'staff', 'partner', 'developer', 'engineers']);
const TOPIC_WORDS = new Set(['product', 'business', 'technical', 'customer', 'client', 'digital', 'global', 'enterprise', 'data']);
const words1 = (alt) => alt.split(/\s+/).map(w => w.replace(/\*$/, ''));
const roleRatio = (alts) => alts.filter(a => words1(a).every(w => ROLE_WORDS.has(w))).length / alts.length;   // share of role-word alternatives
// An OR group in the gate is only as selective as its most generic alternative:
// 2 = some alternative is only role words, 1 = some alternative is only role/topic words, 0 = all distinctive
const altScore = (a) => (words1(a).every(w => ROLE_WORDS.has(w)) ? 2 : words1(a).every(w => ROLE_WORDS.has(w) || TOPIC_WORDS.has(w)) ? 1 : 0);
const genericity = (alts) => Math.max(...alts.map(altScore));

// One pattern string -> its tokens: { q: tsquery text, n: number of alternatives, len: longest lexeme }.
function tokenize(pattern) {
  const toks = [];
  const re = /\(([^)]*)\)|\S+/g;
  let m;
  while ((m = re.exec(pattern))) {
    if (m[1] !== undefined) {
      const alts = m[1].split('|').map(a => a.trim()).filter(Boolean);
      const qs = alts.map(a => { const w = a.split(/\s+/); return w.length === 1 ? term(w[0]) : `(${phrase(w)})`; });
      toks.push({ q: qs.length === 1 ? qs[0] : `(${qs.join('|')})`, n: alts.length, len: Math.max(...alts.map(a => a.length)), generic: genericity(alts), ratio: roleRatio(alts),
        singles: qs.filter((_, i) => !/\s/.test(alts[i])), multis: qs.filter((_, i) => /\s/.test(alts[i])) });
    } else toks.push({ q: term(m[0]), n: 1, len: m[0].length, generic: genericity([m[0]]), ratio: roleRatio([m[0]]), singles: [term(m[0])], multis: [] });
  }
  if (!toks.length) throw new Error(`empty pattern: ${pattern}`);
  return toks;
}

// One pattern string -> tsquery text.
// A group that is followed by more tokens and holds multi-word alternatives is split into one disjunct per
// phrase: PostgreSQL lets `('product' | 'senior' <-> 'product') <-> 'manager'` match "Senior Product Ops
// Manager" (one stray word) when the single and the phrase end on the same word, so the phrases must not
// share an OR with the singles. A final group is fine as it is.
export function compilePattern(pattern) {
  const wrap = (list) => (list.length === 1 ? list[0] : `(${list.join('|')})`);
  const build = (toks) => {
    if (toks.length === 1) return toks[0].q;
    const [first, ...rest] = toks;
    const r = build(rest);
    if (!first.multis.length) return `${wrap(first.singles)} <-> ${r}`;
    const parts = [...(first.singles.length ? [`${wrap(first.singles)} <-> ${r}`] : []), ...first.multis.map(m => `${m} <-> ${r}`)];
    return `(${parts.join(' | ')})`;
  };
  const toks = tokenize(pattern);
  return toks.length === 1 ? toks[0].q : `(${build(toks)})`;
}

// The cheapest token every match of the pattern must contain: fewest alternatives, then the longest
// (rarer) word. A match of the whole pattern contains it, so OR-ing these anchors gives a superset that GIN
// can walk without evaluating phrases or the veto tree.
export function patternAnchor(pattern) {
  const toks = tokenize(pattern);
  toks.sort((a, b) => a.generic - b.generic || a.ratio - b.ratio || a.n - b.n || b.len - a.len);
  return toks[0].q;
}

const or = (parts) => parts.length === 1 ? parts[0] : `(${parts.join('|')})`;


// ---- families -------------------------------------------------------------------------
const SW = 'app|drupal|qa automation|backend|back-end|back end|frontend|front-end|front end|full stack|full-stack|fullstack|web|mobile|ios|android|platform|infrastructure|devops|cloud|security|embedded|firmware|java|python|golang|react|node|javascript|typescript|ruby|php|kotlin|swift|rust|scala|c#|api|game|blockchain|qa|salesforce|wordpress|shopify|database|sre|site reliability|rails|django|angular|vue|flutter|unity|unreal|dotnet|graphics|compiler|kernel|search|payments|saas';
const ML = 'ml|ai|ai/ml|ml/ai|machine learning|llm|mlops|nlp|computer vision|deep learning|genai';
const DATA = `data|${ML}`;

// Shared vetoes: a title that reads as software engineering / data science is not a business-function
// role, whatever business word it also carries ("Software Engineer, Marketing Platform").
export const MACROS = {
  '@eng': [
    'software (engineer*|developer*|architect*|engineering|development)', `(${SW}|${DATA}) (engineer*|developer*)`, 'sde', 'swe', 'devops', 'sdet', 'sre',
  ],
  '@data': [`(data|${DATA}) scientist*`],
};

export const FAMILIES = [
  {
    slug: 'engineering', label: 'Software engineering', gin: false,
    any: [
      'software (engineer*|developer*|development engineer*|architect*|engineering|development|dev)',
      `(${SW}|${DATA}|test automation|systems software|distributed systems|product|performance|cybersecurity|ai research|backend/infra|infra) (engineer*|developer*)`,
      'sde', 'swe', 'sdet', 'devops', 'mlops', 'full-stack', 'fullstack', 'full stack',
      '(site reliability|devops|platform|infrastructure|cloud|security) engineering',
      'forward deployed engineer*', 'founding engineer*', 'member of technical staff', 'cloud architect*',
      `(software|${SW}|${DATA}) engineering (manager*|director|lead)`, '(director|head|vp) of (software engineering|engineering)',
    ],
    not: [
      '(sales|solutions|solution|field|mechanical|electrical|civil|process|quality|manufacturing|hvac|support|customer|application*|pre-sales|presales|technical sales|validation|hardware|industrial|chemical|structural|biomedical|environmental|maintenance|facilities|plant|project|automotive|aerospace|controls|power|rf|optical|safety|test|commissioning|construction|design|systems|network|installation|service|geotechnical|petroleum|reservoir|drilling|production|packaging|materials|nuclear|marine|mining|water|transportation|traffic|building|mep|fire|cost|sourcing|supplier|lab|clinical|utility|substation|calibration|instrumentation|cad|tooling|welding|machine|sustaining|npi|failure|analog|digital|asic|fpga|rtl|verification|layout|device|yield) engineer*',
      '(business|real estate|property|land|community|economic|sales|partner|partnerships|channel|market|talent|leasing|residential|commercial) developer*',
      'developer (relations|advocate*|evangelist|marketing|success|experience)',
    ],
  },
  {
    slug: 'data-ml', label: 'Data & machine learning', gin: true,
    any: [
      `(data|${DATA}|applied|decision|quantitative) scientist*`,
      '(data|analytics|bi|business intelligence|etl|big data) (engineer*|developer*|architect*|analyst*|modeler|steward|engineering|science|analytics)',
      `(${ML}|applied ai|applied ml|ai research|ml research) (engineer*|researcher*|scientist*|architect*|developer*|engineering|research)`,
      'scientist* (machine learning|ml|ai|nlp|computer vision)',
      'applied scientist*', 'mlops', 'analytics engineer*', 'statistician*', 'biostatistician*', 'business intelligence',
      '(analytics|bi) (analyst*|developer)', 'machine learning',
      'prompt engineer*',
    ],
    not: ['data entry', 'data center', 'data centre', 'data protection', 'data privacy', '(sales|solutions|field|mechanical|electrical|civil|process|quality|manufacturing|hvac|support|customer|hardware|test|systems|network) engineer*'],
  },
  {
    slug: 'product', label: 'Product management', gin: true,
    any: [
      '(product|technical product|group product|associate product|principal product|staff product|senior product|lead product) (manager*|management|owner*|lead)',
      '(head|director|vp|chief|vice president) of product', 'vice president product', 'chief product officer', 'product management', 'product owner*',
    ],
    not: ['production manager', 'product marketing', 'product support', 'product development'],
  },
  {
    slug: 'design', label: 'Design', gin: true,
    any: [
      '(product|ux|ui|ux/ui|ui/ux|visual|graphic|brand|interaction|motion|web|creative|communication|digital|service|content|packaging|game|presentation|marketing|user experience|user interface|3d) designer*',
      '(ux|ui|user experience) (researcher*|writer|architect|strategist|director|manager)', 'design director*',
      'art director*', 'creative director*', 'illustrator*', 'head of design', 'director of design',
      'ux/ui', 'ui/ux', 'graphic design*', 'visual design*', 'product design*', 'motion graphics', 'videographer*', 'video editor*',
      '(3d|concept|game|technical) artist*',
    ],
    not: ['@eng', '(hardware|ic|analog|electrical|mechanical|civil|piping|cad|rf|asic|structural|kitchen|landscape|lighting|floral|hair|engineering) designer*', '(design|ui|ux|ui/ux|ux/ui) engineer*', 'hardware product design'],
  },
  {
    slug: 'sales', label: 'Sales', gin: true,
    any: [
      'sales (representative*|rep|reps|manager*|director*|executive*|specialist*|consultant*|lead|development|advisor*|professional*|agent*|coordinator*|engineer*|account*|strategist|operations|enablement|assistant|expert|analyst*)',
      '(ad|medical|technical|enterprise|b2b|wholesale|direct|digital|channel|partner|pharma|real estate|insurance|automotive|car|saas|solution|solutions) sales',
      'account (executive*|manager*|director*|representative*)', '(key|strategic|enterprise|named|major|national) account (executive*|manager*|director*|representative*)', 'territory (manager*|sales*)',
      '(inside|outside|field|channel|regional|area|district) sales*',
      '(director|head|vp|vice president|chief) of (sales|business development|revenue)', 'head of sales',
      'business development (representative*|rep|manager*|director*|associate*|executive*|specialist*|lead|consultant*)',
      'business development', 'sales (trainee|intern*|team lead)', 'telesales', 'sdr', 'bdr', 'sdr/bdr', 'bdr/sdr', 'solutions engineer*', 'solution engineer*', 'presales', 'pre-sales', 'client partner*', 'relationship manager*',
    ],
    not: ['@eng', 'sales tax', 'sales associate*', 'seasonal', 'retail sales', 'sales floor', 'sales clerk', 'sales operations planning', 'sales and operations'],
  },
  {
    slug: 'marketing', label: 'Marketing', gin: true,
    any: [
      'marketing (manager*|director*|specialist*|coordinator*|associate*|analyst*|lead|executive*|strategist*|intern*|operations|communications|officer|consultant*|assistant*|generalist|technologist|automation|campaign*|analytics|content|ops)',
      '(digital|content|product|growth|brand|performance|email|lifecycle|social media|field|channel|demand generation|partner|event|affiliate|influencer|paid|b2b|ecommerce|e-commerce|trade|crm|retention|community|partnership|campaign|seo|sem|search) marketing',
      '(content|social media|seo|sem|brand|community|email|crm|lifecycle|affiliate|influencer|paid media|paid social|demand generation) (manager*|specialist*|strategist*|writer*|coordinator*|lead|director*|analyst*|creator*|producer*|marketer*)',
      'growth (manager*|lead|director*|marketer*|specialist*|strategist*|analyst*)',
      'copywriter*', 'content writer*', 'content creator*', 'communications (manager*|director*|specialist*|coordinator*|lead)',
      'public relations', 'pr (manager*|specialist*|coordinator*|director*)', 'brand (manager*|strategist*|director*)', 'marketer*', 'marketing', 'cmo', 'chief marketing officer', 'head of marketing', 'vp of marketing', 'director of marketing', 'head of growth', 'demand generation', 'social media',
    ],
    not: ['@eng', '@data', 'marketplace'],
  },
  {
    slug: 'customer', label: 'Customer support & success', gin: true,
    any: [
      'customer (support|success|service|services|care|experience|happiness|advocate*|relations|engagement|onboarding|education|champion|operations)',
      'client (success|services|service|support|experience|relations|care)',
      '(technical|product|it|tier 1|tier 2|tier 3|l1|l2|l3|saas|enterprise|senior|bilingual|chat|phone|email|inbound|remote|member|patient|guest|user|community|merchant|seller|partner|dealer|order) support (specialist*|engineer*|representative*|agent*|associate*|analyst*|advocate*|manager*|lead|technician*|team|coordinator*|rep|professional*)',
      'support (specialist*|representative*|agent*|associate*|advocate*|rep|reps)',
      'help desk', 'helpdesk', 'service desk', 'desktop support', 'call center', 'call centre', 'contact center', 'contact centre',
      'technical account manager*', 'csm', 'onboarding (specialist*|manager*|coordinator*|associate*)',
      '(renewal|renewals) (manager*|specialist*)', 'client (benefits|solutions|retention) representative*',
    ],
    not: ['@eng', 'sales support', 'qa support', 'administrative support', 'direct support', 'program support', 'business support'],
  },
  {
    slug: 'operations', label: 'Operations & supply chain', gin: true,
    any: [
      '(operations|business operations|bizops|strategic operations|operational) (manager*|analyst*|coordinator*|specialist*|director*|supervisor*|officer|administrator*|excellence|improvement|planner*)',
      '(head|director|vp|chief|manager|lead) of (operations|supply chain|logistics|procurement|purchasing|planning|fulfillment)',
      'supply chain', 'logistics (manager*|coordinator*|analyst*|specialist*|supervisor*|associate*|planner*|director*|lead|clerk|administrator*)', 'procurement', 'purchasing', 'buyer*',
      '(demand|supply|inventory|materials|capacity|master|transportation|distribution|fleet|vendor|category|strategic|sourcing|assortment|replenishment) (planner*|planning|manager*|analyst*|coordinator*|specialist*|scheduler*|supervisor*|buyer*|controller*)', 'production (planner*|planning|scheduler*|controller*)', 'master scheduler',
      'chief operating officer', 'coo', 'chief of staff', 'continuous improvement', 'six sigma', 'dispatcher*', 'inventory (control|specialist*|analyst*|clerk|manager*|associate*|coordinator*)', 'order (fulfillment|management|processor*|entry)', 'freight', 'trade compliance',
    ],
    not: ['@eng', '@data', '(security|network|clinical|sales|revenue|marketing|people|hr|it|store|restaurant|retail|branch|bank|banking|trading|fund|investment|plant|manufacturing|production|field|site|facility|facilities|hotel|food|school|hospital|medical|dental|pharmacy|lab|laboratory|research|trial|care|home|center|office|business support|data|ai|ml|software|cloud|platform|infrastructure) operations*', 'devops', 'operations engineer*', 'operations research', 'barista*', 'cashier*', 'cybersecurity', 'culinary', 'hubspot', 'salesforce', 'capacity analyst', '(product|program|project) manager*', 'client operations', 'customer operations', 'advertising operations', 'support operations', '(real estate|talent|commercial|grocery|food|apparel|fashion|wine|art|book|media|music|film|inventory) buyer*'],
  },
  {
    slug: 'finance', label: 'Finance & accounting', gin: true,
    any: [
      'accountant*', 'accounting', 'bookkeeper*', 'bookkeeping', 'controller*', 'comptroller*', 'auditor*', 'internal audit', 'audit (manager*|associate*|senior|analyst*|director*|intern*|staff|lead|specialist*)',
      '(financial|finance|credit|treasury|investment|equity|tax|revenue|cost|pricing|budget|payroll|collections|lending|loan|mortgage) (analyst*|manager*|director*|associate*|specialist*|accountant*|controller*|lead|officer|coordinator*|supervisor*|advisor*|planner*|consultant*|clerk|administrator*|assistant*|intern*|vp|auditor*|examiner*|underwriter*|processor*|representative*)',
      '(credit|financial|market|treasury) risk', 'vp finance', 'business finance', 'tax', 'accounts payable', 'accounts receivable', 'ap/ar', 'payroll', 'treasury', 'fp&a', 'fp', 'cfo', 'chief financial officer', 'vp of finance', 'head of finance', 'director of finance',
      'investment (banking|banker*)', 'private equity', 'wealth (manager*|advisor*|management)', 'financial advisor*', 'actuary', 'actuarial', 'underwriter*', 'cpa', 'general ledger', 'financial reporting', 'financial planning',
    ],
    not: ['@eng', '@data', '(quality|night|safety|energy|environmental|food|security|compliance) auditor*', '(vehicle|motor|flight|traffic|robot|plc|machine|engine|motion|battery|drone|air traffic) controller*', 'sales tax', 'tax credit', 'finance systems engineer*', 'financial software', 'financial crimes', 'finance and insurance', 'finance & insurance', 'f&i', '(data|software|security|cloud|network|infrastructure|systems|ai|ml) (controller*|auditor*)', 'lending (platform|software)'],
  },
  {
    slug: 'hr', label: 'HR & recruiting', gin: true,
    any: [
      'human resources', 'human resource', 'hr (manager*|generalist|assistant|business|coordinator*|specialist*|director*|analyst*|admin*|executive|intern*|lead|operations|advisor*|officer|partner|consultant*|head|vp)', '(head|director|vp|manager) of hr', 'hr & recruitment', 'hr and recruitment', 'recruiter*', 'recruiting', 'recruitment', 'talent acquisition', 'sourcer*',
      'talent (partner*|sourcer*|acquisition|management|advisor*|manager*|specialist*|coordinator*|lead|director*|operations|consultant*|development|attraction|programs|business partner)',
      'people (advisor*|operations|partner*|business partner*|team|ops|and culture|& culture|experience|generalist|coordinator*|specialist*|director*|programs|success)',
      'employee (relations|experience|engagement|benefits)', 'employee benefits', 'benefits (manager*|administrator*|analyst*|director*|partner*)', 'compensation (analyst*|manager*|specialist*|director*|consultant*|partner*)', 'total rewards',
      'learning and development', 'learning & development', 'l&d', 'hris', 'chro', 'chief people officer', 'head of people', 'vp of people', '(intern|executive|hoofd|people|head|senior|sr|associate|assistant) hr', 'hr (ops|systems|compliance|policy|programs|analytics|payroll)', 'workforce planning', 'labor relations', 'organizational development', 'headhunter*', 'staffing (specialist*|manager*|coordinator*|consultant*)',
    ],
    not: ['@eng', '@data', 'recruiting platform engineer*', 'recruitment marketing', 'student recruiter*', 'admissions', 'sales compensation', 'benefits sales', 'training expert', 'trial recruitment', 'trial awareness', 'recruiting support', 'recruitment support', '(solution|solutions|enterprise|technical|data|systems) architect*', 'client benefits', 'family benefits', 'supplemental benefits', 'member benefits', 'hr tech', 'workforce management'],
  },
  {
    slug: 'healthcare', label: 'Healthcare', gin: false,
    any: [
      'nurse*', 'nursing', 'physiotherapist*', 'pmhnp', 'direct care worker*', 'behavior technician*', 'personal support worker*', '(occupational|speech|physical) therapy', 'rn', 'lpn', 'lvn', 'cna', 'crna', 'physician*', 'surgeon*', 'doctor*', 'dentist*', 'pharmacist*', 'therapist*', 'phlebotomist*', 'paramedic*', 'psychologist*', 'psychiatrist*', 'hygienist*', 'optometrist*', 'sonographer*', 'dietitian*', 'veterinar*', 'clinician*', 'caregiver*', 'hospitalist*', 'radiologist*', 'pathologist*', 'anesthesiologist*', 'midwife*', 'audiologist*', 'chiropractor*',
      'medical (assistant*|technologist*|director|officer|receptionist*|biller*|coder*|scribe*|technician*|lab|laboratory|practitioner*|specialist*|provider*|oncologist*|resident*)',
      'physician assistant*', 'pharmacy (technician*|tech|intern*|manager*|assistant*|clerk|associate*)', 'dental (assistant*|hygiene|technician*|receptionist*|office|front desk)',
      'home health', 'home care', 'hospice', 'patient (care|access|service*|coordinator*|representative*|advocate*|navigator*|registrar*|transport*|sitter*|safety)',
      'radiology', 'radiologic*', 'respiratory (therapist*|care)', 'surgical (technologist*|tech|technician*|assistant*)', 'sterile processing', 'emergency (room|department|medicine|physician*|medical)', 'emt',
      'clinical (nurse*|coordinator*|specialist*|manager*|director*|supervisor*|educator*|pharmacist*|instructor*|assistant*|technician*|psychologist*|social worker*|therapist*|counselor*|dietitian*|staff)',
      'clinic (manager*|coordinator*|director*|nurse*|assistant*|supervisor*|receptionist*|administrator*)',
      'mental health', 'behavioral (health|technician*|therapist*)', 'medical laboratory', 'medical lab', 'clinical laboratory',
      'health (aide|care assistant*|care worker*|educator*)', 'healthcare (assistant*|worker*|professional*|provider*|specialist*|aide)', 'wound care', 'dialysis', 'travel (nurse*|rn|therapist*|allied|healthcare)', 'allied health', 'primary care', 'urgent care', 'family (medicine|practice)', 'internal medicine',
    ],
    not: ['@eng', '@data', '(software|data|machine learning|sales|marketing|product|business|solutions|cloud|security|account|customer|ai|ml|finance|financial|legal|hr|recruiting|recruiter|talent|design|designer|analytics|analyst|operations|engineering|developer|it) (healthcare|health care|medical|clinical|patient|nursing)', 'healthcare (software|data|sales|marketing|recruiter|product|account|analytics|it|consultant)', 'clinical (research|data|trial|trials|affairs|operations|development|programmer|sas|monitor*|study|safety|regulatory|project|quality|science|scientist|supplies)', 'medical (sales|device sales|science liaison|writer|writing|affairs|information|device|billing|coding)', 'therapist recruiter*', 'physician recruiter*', 'nurse recruiter*'],
  },
  {
    slug: 'education', label: 'Education', gin: true,
    any: [
      'teacher*', 'teaching assistant*', 'teaching residency', 'professor*', 'educator*', 'director of education', 'lecturer*', 'tutor*', '(language|math|mathematics|science|english|spanish|french|german|chinese|arabic|history|economics|physics|chemistry|biology|computer|business|art|music|college|university|school|classroom|clinical|nursing|esl|virtual|online|adjunct|lead|assistant|associate|substitute|stem|subject|training|vocational|teaching|instructional|academic|hca) instructor*', 'faculty', 'adjunct', 'paraprofessional*', 'preschool', 'pre-k', 'kindergarten', 'substitute teacher*',
      'school (counselor*|psychologist*|principal*|administrator*|teacher*|social worker|librarian*)', 'headmaster*', 'superintendent of schools', 'school superintendent', '(deputy|assistant) superintendent of schools', 'curriculum',
      'instructional (designer*|coach*|specialist*|assistant*|aide*|technologist*|leader*|coordinator*)', 'academic (advisor*|coach*|counselor*|coordinator*|director*|success|support|tutor*|affairs)',
      'education (coordinator*|director*|specialist*|manager*|consultant*|assistant*|program*|technician*|associate*|aide|advisor*)', 'special education', 'esl', 'tefl', 'esol', 'student (services|success|support|affairs|advisor*|life|engagement)', 'librarian*', 'k-12', 'k12', 'early childhood', 'classroom',
    ],
    not: ['@eng', '@data', '(health|patient|diabetes|community health|wellness|nutrition|benefits|clinical) educator*', '(sales|customer|product|software|data|solutions|marketing|account|business|technical|support|security|cloud|ai|ml|finance|legal|hr|it|enterprise|partner|channel|developer|engineering) (education|instructor*|trainer*|coach*|school|college|university|campus|curriculum)', 'customer education', '(fitness|flight|driving|yoga|pilates|swim*|ski|dance|martial arts|cpr|firearms|rock climbing|scuba|spin|barre|zumba|boxing|tennis|golf) instructor*', 'university recruiter*', 'campus recruiter*', 'college recruiter*'],
  },
  {
    slug: 'legal', label: 'Legal', gin: true,
    any: [
      'attorney*', 'lawyer*', 'counsel', 'paralegal*', 'legal', 'litigation', 'litigator*', 'law clerk*', 'general counsel', 'patent (attorney*|agent*|counsel|paralegal*|lawyer*)', 'trademark', 'esquire', 'court (reporter*|clerk*|interpreter*|administrator*)', 'immigration (attorney*|paralegal*|specialist*|lawyer*)',
    ],
    not: ['@eng', '@data', 'law enforcement', 'legal talent', 'legal requirements', 'legal education', 'legal solutions', 'marketing', 'translator*', 'legal recruiter*', 'legal (nurse|software|engineer*|developer*|tech|technology|sales|recruiter|data|product|marketing|ai)', 'counsel (sales|software)'],
  },
  {
    slug: 'frontline', label: 'Retail, food & hospitality', gin: false,
    any: [
      'cashier*', 'barista*', 'waiter*', 'waitress*', 'bartender*', 'busser*', 'hostess', 'host/hostess', 'cook', 'cooks', 'chef*', 'dishwasher*', 'line cook', 'prep cook',
      'kitchen (manager*|staff|assistant*|helper*|supervisor*|lead|worker*|team member)', 'food (service*|runner*|prep*|server*|handler*|and beverage|& beverage|worker*|attendant*)', 'f&b',
      'restaurant (manager*|general manager*|supervisor*|staff|crew|team member|associate*|server*|cook*|host*|assistant*|worker*)', 'crew member*', 'team member*', 'shift (supervisor*|leader*|lead|manager*)',
      'store (manager*|associate*|clerk*|team member*|assistant*|supervisor*|leader*|lead|keeper*|employee*|worker*)', 'retail (associate*|sales|manager*|stylist*|specialist*|assistant*|clerk*|supervisor*|team member*|consultant*|advisor*|representative*|cashier*|merchandis*|lead|keyholder*|worker*|professional*)', 'sales associate*', 'sales floor',
      'stocker*', 'stock (associate*|clerk*|person|team member|worker*|handler*|crew)', 'merchandiser*', 'keyholder*', 'key holder*', 'assistant store manager*', 'assistant restaurant manager*',
      'guest (service*|services|experience|relations|advocate*|attendant*|representative*|ambassador*|care|specialist*|associate*)', 'front desk', 'hotel (manager*|associate*|clerk*|receptionist*|staff|attendant*|supervisor*|housekeep*|front desk|night auditor)', 'housekeep*', 'concierge*', 'night auditor*', 'banquet*', 'catering', 'sandwich artist*', 'baker*', 'butcher*', 'deli (clerk*|associate*|team member|worker*)', 'bagger*', 'courtesy clerk*', 'produce (clerk*|associate*|manager*|team member)', 'valet*', 'bellman', 'bellhop*', 'lifeguard*', 'drive thru', 'drive-thru', 'fry cook', 'dietary aide', 'sommelier*', 'barback*', 'room attendant*', 'flight attendant*', 'tour guide',
    ],
    not: ['@eng', '@data', '(sql|database|web|application|app|mail|file|windows|linux|network|cloud|unix|backend|game|proxy|dns|vpn|print|domain|ldap|exchange|storage|systems|it|infrastructure|software|data) server*', '(sales|software|data|machine learning|ai|ml|cloud|security|account|customer|product|marketing|finance|legal|hr|business|technical|solutions|enterprise|partner|channel|developer|engineering|it) (cook*|chef*|team member*|crew member*|server*|store)', 'cook county', 'sales development', 'concierge representative*', 'sales associate* (sdr|bdr)', 'retail (software|data|analytics|engineer*|developer*|product|marketing|finance|legal|hr|recruiter|account|buyer|planner|category|replenishment|pricing|real estate|banking|bank)', 'team member* (software|engineering)', 'front desk (software|engineer*)'],
  },
];

const BY_SLUG = new Map(FAMILIES.map(f => [f.slug, f]));
const cache = new Map();

// One family as its positive tsquery, its veto tsquery (null when it has none) and the GIN `gate`: the
// OR of each pattern's anchor token, a cheap superset of `pos` (see patternAnchor). familyQuery() is the
// single-tsquery form ("pos & !neg").
export function familyParts(slug) {
  if (cache.has(slug)) return cache.get(slug);
  const f = BY_SLUG.get(slug);
  if (!f) throw new Error(`unknown role: ${slug}`);
  const pos = or(f.any.map(compilePattern));
  const vetoes = f.not.flatMap(n => (MACROS[n] || [n])).map(compilePattern);
  const gate = or([...new Set(f.any.map(patternAnchor))]);
  const parts = Object.freeze({ pos, neg: vetoes.length ? or(vetoes) : null, gate });
  cache.set(slug, parts);
  return parts;
}
export function familyQuery(slug) {
  const { pos, neg } = familyParts(slug);
  return neg ? `${pos} & !${neg}` : pos;
}

Object.freeze(FAMILIES);

// ---- public API -------------------------------------------------------------------------
export const roleList = () => FAMILIES.map(({ slug, label }) => ({ slug, label }));
export const isRoleSlug = (s) => typeof s === 'string' && BY_SLUG.has(s);
export const roleLabel = (slug) => BY_SLUG.get(slug)?.label ?? null;

// The expression the GIN index is built on. feedQuery.js must use exactly this.
export const TITLE_TSV = `to_tsvector('simple', f.title)`;
// The exact test written as the function behind @@ instead of the operator: no index can serve it, and the
// planner prices an opaque boolean function at a flat 1/3 instead of the tsmatchsel guess (0.5% for a tsvector
// it has no statistics for, which sends it to "bitmap + Sort" in a city where the ordered feed_at index
// answers in 2 ms). Dense filters use only this; GIN filters use it to verify what the index returned.
export const titleMatches = (param) => `ts_match_vq(${TITLE_TSV}, ${param}::tsquery)`;

// What the SQL builder needs for one title filter (see titleClauses in feedQuery.js):
//   tsquery   the exact predicate, applied as titleMatches() (never indexable)
//   gate      a cheap positive-only superset (OR of pattern anchors) that GIN can walk through
//             idx_feed_title_tsv, or null when GIN is the wrong plan for this filter
//   pageGate  also gate the page query (the planner then chooses), not only the capped count
// Measured on 300k synthetic rows with ~16% engineering titles (scripts/explain-feed.js, PR description):
//  - Page queries are best served by the ordered feed_at index with the title test as a filter for every family
//    (a few ms: 25 hits need 25/density rows), so family filters never gate the page.
//  - The capped count must find 1001 matches or scan everything. Through the gate it is 5-50 ms for the sparse
//    families (legal 5, hr 10, product 6, design 12) against 90-260 ms scanning; for the dense ones (engineering,
//    healthcare, frontline) the gate is no faster than scanning (38-45 ms), and the GIN bitmap on the full
//    positive tree would be a trap (300-950 ms), so they carry gin:false and are only scanned.
//  - A profile made only of literal phrases (no family) can be arbitrarily rare; there a scan would walk the whole
//    index for a handful of hits, so its page query is gated too and the planner picks the cheaper plan.
export function roleFilter(slug) {
  const f = BY_SLUG.get(slug);
  if (!f) throw new Error(`unknown role: ${slug}`);
  return { tsquery: familyQuery(slug), gate: f.gin ? familyParts(slug).gate : null, pageGate: false };
}

// FEED_ROLE_MATCH kill switch: off unless explicitly 'on'. Read per call (tests, restarts).
export function roleMatchEnabled(env = process.env) {
  return ['on', '1', 'true'].includes(String(env.FEED_ROLE_MATCH || '').toLowerCase());
}

// ---- profile -----------------------------------------------------------------------------
const SENIORITY = new Set(['senior', 'sr', 'staff', 'lead', 'principal', 'junior', 'jr', 'associate', 'ii', 'iii', 'iv', 'intern', 'interim']);
const ROLE_NOUN = new Set(['engineer', 'engineers', 'engineering', 'developer', 'developers', 'scientist', 'analyst', 'manager', 'designer',
  'architect', 'researcher', 'specialist', 'consultant', 'recruiter', 'accountant', 'administrator', 'coordinator', 'director', 'officer',
  'nurse', 'teacher', 'attorney', 'lawyer', 'writer', 'editor', 'producer', 'strategist', 'technician', 'assistant', 'representative',
  'executive', 'owner', 'programmer', 'therapist', 'physician', 'counsel', 'paralegal', 'marketer', 'buyer', 'planner', 'auditor']);
const MAX_PROFILE_PHRASES = 5;

const words = (s) => s.toLowerCase().replace(/\([^)]*\)/g, ' ').split(/[^a-z0-9+#./&-]+/).map(w => w.replace(/^[^a-z0-9]+|[^a-z0-9+#]+$/g, '').replace(/\.$/, '')).filter(Boolean);

// "Senior Software Engineer (Java)" -> "software engineer"; "Team Lead, Software Engineering" ->
// "software engineering"; "Machine Learning Engineer, GAI Search Platform - Moveworks" -> "machine learning engineer".
export function cleanTitle(raw) {
  let t = String(raw || '').replace(/\s+/g, ' ').trim();
  t = t.split(/\s+[-\u2013\u2014|@]\s+|\s+at\s+/i)[0];
  for (const seg of t.split(',')) {
    let w = words(seg);
    const joined = ` ${w.join(' ')} `;
    if (joined.includes(' team lead ')) w = words(joined.replace(' team lead ', ' '));
    w = w.filter(x => !SENIORITY.has(x.replace(/\./g, '')));
    if (!w.length) continue;
    // Keep up to the end of the first run of role nouns; what follows is a team or company.
    const end = w.findIndex((x, i) => ROLE_NOUN.has(x) && !ROLE_NOUN.has(w[i + 1]));
    if (end >= 0) w = w.slice(0, end + 1);
    if (w.length === 1 && ROLE_NOUN.has(w[0]) && /^(engineer|manager|developer|analyst|specialist|consultant|assistant|associate)s?$/.test(w[0])) continue; // too generic alone
    return w.join(' ');
  }
  return '';
}

const titleCase = (s) => s.replace(/\b([a-z])/g, (m) => m.toUpperCase());

// Raw profile rows -> { phrases: [{ text, label }], source }.  apply_preferences.keywords wins when
// non-empty (used verbatim apart from trimming); otherwise the most frequent cleaned preferred titles.
export function profilePhrases({ keywords, preferredTitles } = {}) {
  const seen = new Set(), explicit = [];
  for (const k of Array.isArray(keywords) ? keywords : []) {
    const text = String(k || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (text && !seen.has(text.toLowerCase())) { seen.add(text.toLowerCase()); explicit.push({ text, label: text }); }
  }
  if (explicit.length) return { phrases: explicit.slice(0, 8), source: 'keywords' };
  const freq = new Map();
  for (const t of Array.isArray(preferredTitles) ? preferredTitles : []) {
    const c = cleanTitle(t);
    if (c) freq.set(c, (freq.get(c) || 0) + 1);
  }
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_PROFILE_PHRASES);   // stable: ties keep first-seen order
  return { phrases: top.map(([text]) => ({ text, label: titleCase(text) })), source: top.length ? 'titles' : null };
}

const lexemes = (phraseText) => words(phraseText).flatMap(w => w.split(/[-+#&]+/)).filter(Boolean);

// A literal phrase -> tsquery text ("full-stack" -> 'full' <-> 'stack'); the last word is a prefix when
// it is long enough that 'engineer' also finds engineers/engineering.
export function phraseQuery(phraseText) {
  const lx = lexemes(phraseText);
  if (!lx.length) return null;
  return lx.map((w, i) => `'${w.replace(/'/g, "''")}'${i === lx.length - 1 && w.length >= 6 ? ':*' : ''}`).join(' <-> ');
}

const famMemo = new Map();   // phrase -> Promise<string[]>   (bounded, families are static)

// Which families does each phrase itself fall in?  Asks the database so the answer is exactly what the
// index sees (one tiny query; memoised per phrase). Throws on database failure; the caller degrades.
export async function resolveFamilies(db, phraseTexts) {
  const need = [...new Set(phraseTexts)].filter(p => !famMemo.has(p));
  if (need.length) {
    const p = db.query(
      `SELECT p.phrase, f.slug
         FROM unnest($1::text[]) AS p(phrase)
         JOIN unnest($2::text[], $3::text[]) AS f(slug, q) ON to_tsvector('simple', p.phrase) @@ f.q::tsquery`,
      [need, FAMILIES.map(f => f.slug), FAMILIES.map(f => familyQuery(f.slug))]);
    for (const phrase of need) famMemo.set(phrase, p.then(({ rows }) => rows.filter(r => r.phrase === phrase).map(r => r.slug)));
    if (famMemo.size > 2000) famMemo.clear();
    p.catch(() => { for (const phrase of need) famMemo.delete(phrase); });
  }
  const sets = await Promise.all(phraseTexts.map(p => famMemo.get(p)));
  return [...new Set(sets.flat())];
}
export const _clearFamilyMemo = () => famMemo.clear();

// The default-list profile match: the literal phrases OR the families they fall in -> a filter like
// roleFilter()'s, or null when nothing usable. Gated only when every family in the mix is a gin family
// (a profile that includes engineering is dense, whatever else it lists).
export function profileFilter(phrases, familySlugs = []) {
  const lit = phrases.map(p => phraseQuery(p.text)).filter(Boolean).map(q => `(${q})`);
  const fams = FAMILIES.filter(f => familySlugs.includes(f.slug));
  if (!lit.length && !fams.length) return null;
  const tsquery = [...lit, ...fams.map(f => `(${familyQuery(f.slug)})`)].join(' | ');
  const gated = fams.every(f => f.gin);
  const gate = gated ? [...lit, ...fams.map(f => familyParts(f.slug).gate)].join(' | ') : null;
  return { tsquery, gate, pageGate: gated && fams.length === 0 };
}

// ---- fit ranking (FEED_FIT_RANK) ----------------------------------------------------------------
// Inside each near tier the profile list is split into two FIT BUCKETS (feedQuery.js buildNearQuery):
//   bucket 0 "strong fit"  the title matches one of the user's LITERAL profile phrases (the explicit keywords, or
//                          the cleaned preferred-title phrases = profilePhrases().phrases) AND is not a
//                          level / management mismatch for this user
//   bucket 1 "broader fit" everything else in the profile match (family-expansion matches, and literal matches
//                          that are mismatches)
// Mismatch rules are decided per user from their OWN strings (keywords + preferred titles), whole words only:
//   (a) LEVEL   active when the user's strings contain an experienced-level word: senior, sr, staff, principal,
//               lead. Mismatch titles: intern, internship, junior, jr, apprentice, trainee, new grad,
//               new graduate, entry level / entry-level, graduate programme / graduate program.
//               No seniority signal -> the rule is off (an entry-level seeker is never demoted away from entry roles).
//   (b) IC      active when the user's strings contain NONE of: director, vp, vice president, head, chief,
//               manager (an individual-contributor profile). Mismatch titles: director, vp, vice president,
//               head of, chief, manager. Any one of those words in the profile switches the rule off.
// Both are tsqueries over to_tsvector('simple', title), evaluated with ts_match_vq like the profile match itself:
// no new index, the existing GIN / ordered-index plans are unchanged.
const EXPERIENCED = ['senior', 'sr', 'staff', 'principal', 'lead'];
const MGMT_SINGLE = ['director', 'vp', 'head', 'chief', 'manager'];
const LEVEL_MISMATCH = [q('intern'), q('internship'), q('junior'), q('jr'), q('apprentice'), q('trainee'),
  phrase(['new', 'grad']), phrase(['new', 'graduate']), phrase(['entry', 'level']),
  `${q('graduate')} <-> (${q('programme')} | ${q('program')})`];
const MGMT_MISMATCH = [q('director'), q('vp'), phrase(['vice', 'president']), phrase(['head', 'of']), q('chief'), q('manager')];
export const FIT_LABELS = { level: 'Senior-level roles', ic: 'Individual contributor roles' };

const profileTokens = (strings) => ` ${strings.map(s => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).join(' ')).join(' | ')} `;

// { keywords, preferredTitles } -> { level: bool, ic: bool, labels: [...] }
export function fitRules({ keywords, preferredTitles } = {}) {
  const strings = [...(Array.isArray(keywords) ? keywords : []), ...(Array.isArray(preferredTitles) ? preferredTitles : [])];
  const t = profileTokens(strings);
  const has = (w) => t.includes(` ${w} `);
  const level = EXPERIENCED.some(has);
  const ic = !(MGMT_SINGLE.some(has) || has('vice president'));
  return { level, ic, labels: [...(level ? [FIT_LABELS.level] : []), ...(ic ? [FIT_LABELS.ic] : [])] };
}

// The mismatch tsquery text for the active rules, or null when none is active.
export function mismatchQuery(rules) {
  const parts = [...(rules.level ? LEVEL_MISMATCH : []), ...(rules.ic ? MGMT_MISMATCH : [])];
  return parts.length ? parts.map(p => `(${p})`).join(' | ') : null;
}

// Literal phrases + raw profile (+ the families the phrases fall in) -> what the SQL builder needs, or null when there is
// no literal phrase:
//   strong   tsquery text of bucket 0 (ts_match_vq)
//   bucket1  how bucket 1 ("profile match AND NOT strong") can be pruned. Without any family the profile match IS the
//            literal match, so bucket 1 = literal AND mismatch: empty when no rule is active ({ empty: true }), else
//            gated by the positive mismatch words ({ gate }), which GIN walks together with the profile gate instead of
//            scanning the whole index for a bucket that is almost always empty. With families bucket 1 is dense: null.
//   labels   the human fit labels for the response (`match.fit`), empty when no rule is active
export function fitFilter(phrases, profile, familySlugs = []) {
  const lit = phrases.map(p => phraseQuery(p.text)).filter(Boolean).map(x => `(${x})`);
  if (!lit.length) return null;
  const rules = fitRules(profile);
  const mm = mismatchQuery(rules);
  const bucket1 = familySlugs.length ? null : mm ? { gate: mm } : { empty: true };
  return { strong: mm ? `(${lit.join(' | ')}) & !(${mm})` : lit.join(' | '), bucket1, labels: rules.labels, rules };
}
