(() => {
  // src/rules.js
  function findRule(rules, { domain, url, fieldType, label, el }) {
    for (const rule of rules) {
      if (matchesRule(rule.match, { domain, url, fieldType, label, el }))
        return rule;
    }
    return null;
  }
  function matchesRule(match, { domain, url, fieldType, label, el }) {
    if (!match || typeof match !== "object")
      return false;
    if (match.domain && !globMatch(match.domain, domain))
      return false;
    if (match.urlPattern && !url.includes(match.urlPattern))
      return false;
    if (match.fieldType && fieldType !== match.fieldType)
      return false;
    if (match.labelPattern && !label.toLowerCase().includes(match.labelPattern.toLowerCase()))
      return false;
    if (match.selector && el && !el.closest("body,form")?.querySelector(match.selector))
      return false;
    return true;
  }
  function globMatch(pattern, str) {
    const re = new RegExp(
      "^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$"
    );
    return re.test(str);
  }
  function mergeRules(staticRules, remoteRules) {
    const map = new Map((staticRules || []).map((r) => [r.id, r]));
    for (const rule of remoteRules || []) {
      const existing = map.get(rule.id);
      if (!existing || rule.version > existing.version) {
        map.set(rule.id, rule);
      }
    }
    return [...map.values()];
  }

  // src/static-rules.js
  var static_rules_default = [
    // ── Ashby ─────────────────────────────────────────────────────────────────
    // Ashby uses React controlled inputs; nativeSet + fire('input') is ignored.
    // execCommand('insertText') is treated as real user input by React.
    {
      id: "ashby-textarea-execcommand",
      version: 1,
      match: { domain: "*.ashbyhq.com", fieldType: "textarea" },
      fix: { fillMethod: "execCommand" }
    },
    {
      id: "ashby-text-execcommand",
      version: 1,
      match: { domain: "*.ashbyhq.com", fieldType: "text" },
      fix: { fillMethod: "execCommand" }
    }
  ];

  // src/reporter.js
  var REPAIR_URL = "https://elevate-careers-api.fly.dev/api/repair/queue";
  function reportFailure(field, failReason, fillTried = "unknown") {
    if (!field.label || field.label === "(Unlabeled)")
      return;
    const domain = location.hostname;
    const outerHTML = (() => {
      try {
        return (field.el?.outerHTML || "").slice(0, 3e3);
      } catch {
        return "";
      }
    })();
    fetch(REPAIR_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        domain,
        label: field.label,
        fieldType: field.type,
        outerHTML,
        failReason,
        fillTried
      }),
      keepalive: true
      // survives page unload
    }).catch(() => {
    });
  }

  // src/mount.js
  var API_BASE = "https://elevate-careers-api.fly.dev/api/ai-resume";
  var JOB_HOSTS = [
    "greenhouse.io",
    "lever.co",
    "myworkdayjobs.com",
    "ashbyhq.com",
    "smartrecruiters.com",
    "jobvite.com",
    "icims.com",
    "taleo.net",
    "successfactors.com",
    "workable.com",
    "gem.com",
    "rippling.com",
    "bamboohr.com",
    "recruitee.com",
    "dover.com",
    "pinpoint.works",
    "amazon.jobs",
    "jobs.apple.com",
    "careers.google.com",
    "linkedin.com/jobs",
    "indeed.com",
    "glassdoor.com",
    "jobvite.com",
    "ultipro.com",
    "paylocity.com",
    "paycom.com",
    "fountainhq.com",
    "breezy.hr",
    "applytojob.com",
    "hire.com",
    "jobs.netflix.net",
    "careers.netflix.com",
    "jobs.meta.com",
    "metacareers.com",
    "microsoft.com/en-us/careers",
    "careers.microsoft.com",
    "amazon.jobs",
    "jobs.amazon.com",
    "stripe.com/jobs",
    "grnh.se",
    "jobs.lever.co",
    "apply.workable.com",
    "jobs.twilio.com",
    "careers.twilio.com",
    "jobs.airbnb.com",
    "careers.airbnb.com",
    "jobs.dropbox.com",
    "jobs.squarespace.com",
    "jobs.cloudflare.com",
    "careers.cloudflare.com",
    "jobs.stripe.com",
    "jobs.shopify.com",
    "boards.greenhouse.io",
    "jobs.greenhouse.io",
    "careers.jobvite.com",
    "hire.withgoogle.com",
    // Custom career sites detected by detect-ats.js and injected via scripting API
    "kula.ai"
  ];
  var _loc = location.hostname + location.pathname;
  if (!window.__simplyApplyForceInject && !JOB_HOSTS.some((h) => _loc.includes(h))) {
  } else if (window.__simplyApplyRunning) {
  } else {
    window.__simplyApplyRunning = true;
    const _runFn = main();
    if (new URLSearchParams(location.search).get("sa_autofill") === "1" && !window.__saAutoTriggered) {
      window.__saAutoTriggered = true;
      Promise.resolve(_runFn).then((run) => {
        if (typeof run === "function")
          setTimeout(() => run(false).catch(() => {
          }), 3500);
      });
    }
  }
  function main() {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const fire = (el, t) => el.dispatchEvent(new Event(t, { bubbles: true }));
    async function getToken() {
      return new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage({ type: "GET_TOKEN" }, (r) => resolve(r?.token || null));
        } catch (_) {
          resolve(null);
        }
      });
    }
    async function apiCall(path, body, profile) {
      const token = await getToken();
      if (!token)
        throw new Error("Not signed in \u2014 open \u2699 to sign in");
      const res = await fetch(`${API_BASE}${path}`, {
        method: body ? "POST" : "GET",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        ...body ? { body: JSON.stringify({ ...body, profile }) } : {}
      });
      if (res.status === 401)
        throw new Error("Session expired \u2014 open \u2699 to sign in again");
      if (!res.ok) {
        const body2 = await res.json().catch(() => null);
        throw new Error(body2?.message || body2?.error || `API ${res.status}`);
      }
      return res.json();
    }
    (async function pingExtensionInstall() {
      try {
        const { ext_ping_day } = await chrome.storage.local.get("ext_ping_day");
        const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
        if (ext_ping_day === today)
          return;
        const token = await getToken();
        if (!token)
          return;
        const ok = await fetch(`${API_BASE}/ping`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
        }).then((r) => r.ok).catch(() => false);
        if (ok)
          await chrome.storage.local.set({ ext_ping_day: today });
      } catch (_) {
      }
    })();
    let _activeRules = static_rules_default;
    async function loadActiveRules() {
      try {
        const { remoteRules } = await chrome.storage.local.get("remoteRules");
        _activeRules = mergeRules(static_rules_default, remoteRules || []);
      } catch (_) {
        _activeRules = static_rules_default;
      }
    }
    function getRuleFor(field) {
      return findRule(_activeRules, {
        domain: location.hostname,
        url: location.href,
        fieldType: field.type,
        label: field.label || "",
        el: field.el
      });
    }
    let answerCache = {};
    async function loadCache() {
      try {
        const { answerCache: c } = await chrome.storage.local.get("answerCache");
        if (c && typeof c === "object")
          answerCache = c;
      } catch (_) {
      }
    }
    async function saveCache() {
      try {
        await chrome.storage.local.set({ answerCache });
      } catch (_) {
      }
    }
    function cacheKey(label) {
      return label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 120);
    }
    function getCached(label) {
      return answerCache[cacheKey(label)];
    }
    function setCached(label, value) {
      const key = cacheKey(label);
      if (answerCache[key] === value)
        return;
      answerCache[key] = value;
      saveCache();
    }
    let learnedAnswers = {};
    async function loadLearnedAnswers() {
      try {
        const { learnedAnswers: la } = await chrome.storage.local.get("learnedAnswers");
        if (la && typeof la === "object")
          learnedAnswers = la;
      } catch (_) {
      }
    }
    function getLearnedAnswer(label) {
      return learnedAnswers[cacheKey(label)];
    }
    function saveLearnedAnswer(label, value) {
      const key = cacheKey(label);
      if (learnedAnswers[key] === value)
        return;
      learnedAnswers[key] = value;
      try {
        chrome.storage.local.set({ learnedAnswers });
      } catch (_) {
      }
      setCached(label, value);
    }
    const LABEL_TAGS = /* @__PURE__ */ new Set(["LABEL", "LEGEND", "SPAN", "P", "DIV", "H1", "H2", "H3", "H4", "DT", "LI"]);
    const SKIP_EEOC = /gender|lgbtq|race|ethnic|hispanic|latino|veteran|disability|sexual|transgender/i;
    const AGREE_RE = /i agree|i consent|i acknowledge|i certify|terms|privacy policy|by (checking|selecting|clicking)/i;
    function cleanText(t) {
      return (t || "").replace(/\s+/g, " ").replace(/^Q\.\s*/i, "").replace(/\s*Question\b.*$/i, "").replace(/\s*Required\b.*$/i, "").replace(/[*:]+$/, "").trim();
    }
    function groupLabelFor(inputs) {
      for (const el of inputs) {
        const fieldset = el.closest("fieldset");
        const legend = fieldset?.querySelector("legend");
        if (legend) {
          const t = cleanText(legend.textContent);
          if (t)
            return t;
        }
      }
      const anchor = inputs[0];
      const container = anchor.closest("div, section, fieldset") || anchor.parentElement;
      let node = container?.parentElement;
      for (let depth = 0; depth < 5 && node; depth++, node = node.parentElement) {
        for (const child of node.children) {
          if (child === container || child.contains(anchor))
            break;
          if (LABEL_TAGS.has(child.tagName)) {
            const t = cleanText(child.textContent);
            if (t && t.length < 200)
              return t;
          }
        }
      }
      return (anchor.name || "").replace(/[_-]/g, " ").trim() || null;
    }
    function extractLabel(el) {
      if (el.id) {
        const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lbl)
          return cleanText(lbl.textContent);
      }
      const al = el.getAttribute("aria-label");
      if (al?.trim())
        return cleanText(al);
      const alb = el.getAttribute("aria-labelledby");
      if (alb) {
        const t = alb.split(" ").map((id) => document.getElementById(id)?.textContent).filter(Boolean).join(" ");
        if (t.trim())
          return cleanText(t);
      }
      const INPUT_SEL = "input:not([type=hidden]), select, textarea";
      const isRadioGroup = (node2) => {
        const inputs = [...node2.querySelectorAll(INPUT_SEL)];
        return inputs.length > 1 && inputs.every((i) => i.type === "radio" || i.type === "checkbox") && new Set(inputs.map((i) => i.name)).size === 1;
      };
      let node = el.parentElement;
      for (let depth = 0; depth < 8 && node; depth++, node = node.parentElement) {
        const inputCount = node.querySelectorAll(INPUT_SEL).length;
        if (inputCount > 1 && !isRadioGroup(node))
          break;
        for (const lbl of node.querySelectorAll("label")) {
          if (!lbl.contains(el)) {
            const t = cleanText(lbl.textContent);
            if (t && t.length < 200)
              return t;
          }
        }
        const sib = depth === 0 ? el.previousElementSibling : node.previousElementSibling;
        if (sib && LABEL_TAGS.has(sib.tagName)) {
          const t = cleanText(sib.textContent);
          if (t && t.length < 200)
            return t;
        }
        for (const child of node.children) {
          if (child === el || child.contains(el))
            break;
          if (LABEL_TAGS.has(child.tagName)) {
            const t = cleanText(child.textContent);
            if (t && t.length < 200)
              return t;
          }
        }
      }
      const raw = el.placeholder || el.name || el.id || "";
      return raw.replace(/.*\[(.+)\]$/, "$1").replace(/[_-]/g, " ").trim();
    }
    const KEYWORD_RULES = [
      { re: /visa sponsorship|require.*sponsor|sponsor.*visa|h-?1b/i, key: "sponsorship" },
      { re: /authori[sz]ed to work|work auth|legally authoris|eligible to work/i, key: "workAuth" },
      { re: /\bphone\b|\bmobile\b|telephone|cell number/i, key: "phone" },
      { re: /\bcountry\b/i, key: "country" },
      { re: /\bstate\b|\bprovince\b/i, key: "state" },
      { re: /\bcity\b/i, key: "city" },
      { re: /zip|postal code/i, key: "postalCode" },
      { re: /linkedin/i, key: "linkedin" },
      { re: /github/i, key: "github" },
      { re: /website|portfolio/i, key: "portfolio" },
      { re: /\bfull name\b|^name$|your name/i, key: "fullName" },
      { re: /pronoun/i, key: "pronouns" },
      { re: /first name|given name|forename/i, key: "firstName" },
      { re: /last name|surname|family name/i, key: "lastName" },
      { re: /\bemail\b/i, key: "email" },
      { re: /street|address line|mailing address/i, key: "address" },
      { re: /location\b/i, key: "location" },
      { re: /education level|degree level|highest.*degree|level.*education/i, key: "educationLevel" },
      { re: /school name|university|college|institution/i, key: "schoolName" },
      { re: /field of study|area.*study|major|discipline/i, key: "fieldOfStudy" },
      { re: /graduation year|year.*grad|grad.*year/i, key: "graduationYear" },
      { re: /salary|compensation|pay expectation|desired.*pay|expected.*salary/i, key: "salary" },
      { re: /how.*hear|how.*find|how.*learn|where.*hear|referral source/i, key: "heardAbout" },
      { re: /current.*company|most recent.*company|employer/i, key: "currentCompany" }
    ];
    function matchKey(label) {
      const t = label.toLowerCase();
      for (const { re, key } of KEYWORD_RULES) {
        if (re.test(t))
          return key;
      }
      return null;
    }
    const RESUME_RE = /\bresume\b/i;
    const COVER_RE = /cover.?letter/i;
    function fileFieldHaystack(field) {
      const parts = [field.label, field.el.name, field.el.id, field.el.getAttribute("data-field") || ""];
      let node = field.el.parentElement;
      for (let i = 0; i < 6 && node; i++, node = node.parentElement) {
        const heading = node.querySelector("h1,h2,h3,h4,h5,label,legend,strong");
        if (heading && heading !== field.el)
          parts.push(heading.textContent);
        for (const sib of node.children) {
          if (sib === field.el || sib.contains(field.el))
            break;
          if (/^(LABEL|LEGEND|SPAN|P|DIV|H[1-6]|STRONG)$/.test(sib.tagName))
            parts.push(sib.textContent);
        }
      }
      return parts.join(" ");
    }
    function isResumeField(field) {
      if (field.type !== "file")
        return false;
      const haystack = fileFieldHaystack(field);
      if (/linkedin/i.test(field.label + field.el.name + field.el.id))
        return false;
      if (COVER_RE.test(haystack))
        return false;
      if (RESUME_RE.test(haystack))
        return true;
      const accept = field.el.accept || "";
      return /pdf/i.test(accept) && !COVER_RE.test(haystack);
    }
    function isCoverLetterField(field) {
      if (field.type !== "file")
        return false;
      const haystack = fileFieldHaystack(field);
      return COVER_RE.test(haystack);
    }
    function isAgreementField(field) {
      const haystack = [
        field.label,
        field._contextLabel || "",
        field.el.name,
        field.el.id,
        field.el.closest("label,p,div")?.textContent || ""
      ].join(" ");
      if (!AGREE_RE.test(haystack))
        return false;
      if (field.type === "checkbox" || field.type === "radio")
        return true;
      if (field.type === "select-one") {
        return [...field.el.options || []].some((o) => /agree|consent|accept/i.test(o.textContent));
      }
      return false;
    }
    function isCountryCodeField(field) {
      if (field.label && field.label !== "(Unlabeled)")
        return false;
      if (field.type !== "select-one")
        return false;
      const opts = [...field.el.options || []];
      return opts.length > 5 && opts.some(
        (o) => /^\+\d|united states|🇺🇸/i.test(o.textContent) || /^(US|\+1|1)$/.test(o.value.trim())
      );
    }
    async function attachPdfB64(el, b64, filename) {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++)
        bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: "application/pdf" });
      const file = new File([blob], filename, { type: "application/pdf" });
      await attachFileObj(el, file);
    }
    async function attachFileObj(el, file) {
      const dt = new DataTransfer();
      dt.items.add(file);
      const prev = { display: el.style.display, visibility: el.style.visibility, opacity: el.style.opacity };
      el.style.cssText += ";display:block!important;visibility:visible!important;opacity:1!important;";
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "files")?.set;
      if (nativeSetter)
        nativeSetter.call(el, dt.files);
      else
        el.files = dt.files;
      el.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
      el.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
      try {
        const fiberKey = Object.keys(el).find((k) => k.startsWith("__reactFiber") || k.startsWith("__reactInternalInstance"));
        if (fiberKey) {
          let fiber = el[fiberKey];
          while (fiber) {
            const onChange = fiber.memoizedProps?.onChange;
            if (typeof onChange === "function") {
              const noop = () => {
              };
              onChange({ target: el, currentTarget: el, bubbles: true, nativeEvent: new Event("change"), stopPropagation: noop, preventDefault: noop, isPropagationStopped: () => false });
              break;
            }
            fiber = fiber.return;
          }
        }
      } catch (_) {
      }
      const dropZone = el.closest('[class*="upload"],[class*="drop"],[class*="attach"],[class*="resume"],[class*="file"]') || el.parentElement;
      if (dropZone && dropZone !== el) {
        dropZone.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: dt }));
        dropZone.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
      }
      el.style.display = prev.display;
      el.style.visibility = prev.visibility;
      el.style.opacity = prev.opacity;
      if (!el.files?.length)
        throw new Error("attach blocked by browser");
    }
    function isOpenEnded(field) {
      if (field.key)
        return false;
      if (isResumeField(field) || isCoverLetterField(field))
        return false;
      if (isAgreementField(field) || isCountryCodeField(field))
        return false;
      if (SKIP_EEOC.test(field.label))
        return false;
      if (field.type === "combobox" || field.type === "datalist")
        return false;
      if (field.el.tagName === "TEXTAREA")
        return true;
      if (field.type === "text" && field.label.length > 20 && /\?|why|tell|describe|explain|share|what/i.test(field.label))
        return true;
      if (field.label && field.label !== "(Unlabeled)" && !SKIP_EEOC.test(field.label)) {
        if (field.type === "select-one")
          return true;
      }
      return false;
    }
    const FIELD_SEL = "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]):not([type=search]), select, textarea";
    const CUSTOM_DD_SEL = '[role="combobox"]:not([disabled]), [aria-haspopup="listbox"]:not([disabled]), [aria-haspopup="true"]:not([disabled])';
    const SEARCH_RE = /\bsearch\b/i;
    function fieldsFromDoc(doc) {
      try {
        const fields = [...doc.querySelectorAll(FIELD_SEL)].filter((el) => {
          if (el.disabled || el.readOnly)
            return false;
          if (SEARCH_RE.test(el.className) || SEARCH_RE.test(el.name) || SEARCH_RE.test(el.id))
            return false;
          if (el.closest('nav, header, [role=search], form[action*="search"], form[action*="positions"]'))
            return false;
          if (el.type === "file")
            return true;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }).map((el) => {
          const label = extractLabel(el);
          const key = matchKey(label) || matchKey(el.name || "") || matchKey(el.placeholder || "");
          let type = (el.type || el.tagName).toLowerCase();
          if (type === "text" || type === "search") {
            if (el.getAttribute("role") === "combobox" || el.getAttribute("aria-autocomplete") || el.getAttribute("aria-haspopup")) {
              type = "combobox";
            } else if (el.getAttribute("list")) {
              type = "datalist";
            }
          }
          return { el, label: label || "(Unlabeled)", key, type };
        });
        const radiosByName = /* @__PURE__ */ new Map();
        for (const f of fields) {
          if (f.type !== "radio" || !f.el.name)
            continue;
          if (!radiosByName.has(f.el.name))
            radiosByName.set(f.el.name, []);
          radiosByName.get(f.el.name).push(f);
        }
        for (const [, group] of radiosByName) {
          if (group.length < 2)
            continue;
          const groupLabel = groupLabelFor(group.map((f) => f.el)) || group[0].label;
          const merged = {
            el: group[0].el,
            label: groupLabel,
            key: matchKey(groupLabel),
            type: "radio-group",
            radioOptions: group.map((f) => ({ el: f.el, text: f.label }))
          };
          const firstIdx = fields.indexOf(group[0]);
          for (const f of group)
            fields.splice(fields.indexOf(f), 1);
          fields.splice(firstIdx, 0, merged);
        }
        const nativeEls = new Set(fields.map((f) => f.el));
        for (const el of doc.querySelectorAll(CUSTOM_DD_SEL)) {
          if (nativeEls.has(el))
            continue;
          if (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA")
            continue;
          if (el.closest("nav, header, [role=search]"))
            continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0)
            continue;
          const label = extractLabel(el);
          const key = matchKey(label) || matchKey(el.getAttribute("name") || "") || matchKey(el.getAttribute("aria-label") || "");
          fields.push({ el, label: label || "(Unlabeled)", key, type: "custom-select" });
        }
        for (let i = 1; i < fields.length; i++) {
          const f = fields[i];
          if (f.label !== "(Unlabeled)" || f.key)
            continue;
          for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
            const prev = fields[j];
            if (prev.label && prev.label !== "(Unlabeled)") {
              f._contextLabel = prev.label;
              break;
            }
          }
        }
        return fields;
      } catch {
        return [];
      }
    }
    function scanFields() {
      const fields = fieldsFromDoc(document);
      for (const iframe of document.querySelectorAll("iframe")) {
        try {
          const doc = iframe.contentDocument;
          if (doc)
            fields.push(...fieldsFromDoc(doc));
        } catch {
        }
      }
      return fields;
    }
    const _nativeInputSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    const _nativeTextareaSet = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    const _nativeSelectSet = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    function nativeSet(el, value) {
      const setter = el.tagName === "TEXTAREA" ? _nativeTextareaSet : _nativeInputSet;
      if (setter)
        setter.call(el, value);
      else
        el.value = value;
    }
    function nativeSelectSet(el, value) {
      if (_nativeSelectSet)
        _nativeSelectSet.call(el, value);
      else
        el.value = value;
    }
    async function typeIn(el, value, delay = 12) {
      if (el?.id && !el.isConnected) {
        const liveEl = document.getElementById(el.id);
        if (liveEl)
          el = liveEl;
      }
      el.focus();
      nativeSet(el, "");
      fire(el, "input");
      let typed = "";
      for (const ch of String(value)) {
        typed += ch;
        nativeSet(el, typed);
        fire(el, "input");
        await sleep(delay);
      }
      fire(el, "change");
      await sleep(50);
      if (el.value !== typed) {
        nativeSet(el, typed);
        fire(el, "input");
        fire(el, "change");
        await sleep(50);
      }
      el.blur();
      await sleep(80);
      if (el.value !== typed) {
        el.focus();
        nativeSet(el, typed);
        fire(el, "input");
        fire(el, "change");
        el.blur();
        await sleep(80);
      }
      if (el.value !== typed)
        throw new Error(`value did not stick after typing (site cleared it on blur)`);
    }
    async function fillStructured(field, profile) {
      const { el, key, type } = field;
      const raw = profile[key] ?? (key === "fullName" ? `${profile.firstName ?? ""} ${profile.lastName ?? ""}`.trim() || null : null);
      const value = raw === "" || raw == null ? null : raw;
      if (value == null)
        throw new Error("no data for " + key);
      if (type === "select-one" || el.tagName === "SELECT") {
        const opts = [...el.options].map((o) => ({ el: o, text: o.textContent.trim() })).filter((o) => o.text);
        const pick = fuzzyPickOption(opts, value);
        if (!pick)
          throw new Error(`no option for "${value}"`);
        nativeSelectSet(el, pick.el.value);
        fire(el, "input");
        fire(el, "change");
        return;
      }
      if (type === "radio-group") {
        const pick = fuzzyPickOption(field.radioOptions, value);
        if (!pick)
          throw new Error(`no option for "${value}"`);
        if (!pick.el.checked)
          pick.el.click();
        return;
      }
      if (type === "checkbox" || type === "radio") {
        const want = String(value).toLowerCase() !== "no" && !!value;
        if (el.checked !== want)
          el.click();
        return;
      }
      if (type === "file")
        throw new Error("file \u2014 select manually");
      await typeIn(el, value);
    }
    async function fillCountryCode(field) {
      const el = field.el;
      const opts = [...el.options];
      const pick = opts.find((o) => /united states/i.test(o.textContent)) || opts.find((o) => /🇺🇸/.test(o.textContent)) || opts.find((o) => /^\+1\b/.test(o.textContent.trim())) || opts.find((o) => o.textContent.trim() === "+1") || opts.find((o) => ["US", "+1", "1"].includes(o.value.trim()));
      if (!pick)
        throw new Error("US option not found in country code dropdown");
      nativeSelectSet(el, pick.value);
      fire(el, "input");
      fire(el, "change");
    }
    function fuzzyPickOption(opts, hint) {
      const h = String(hint).toLowerCase().trim();
      return opts.find((o) => o.text.toLowerCase() === h) || opts.find((o) => o.text.toLowerCase().startsWith(h)) || opts.find((o) => o.text.toLowerCase().includes(h)) || opts.find((o) => h.includes(o.text.toLowerCase()) && o.text.length > 1) || // "Yes" matches any option starting with "Yes" (e.g. "Yes, no restriction.")
      /^yes/i.test(h) && opts.find((o) => /^yes\b/i.test(o.text)) || // "No" matches any option starting with "No" but prefers ones without sponsorship mention
      /^no/i.test(h) && (opts.find((o) => /^no\b/i.test(o.text) && !/sponsor/i.test(o.text)) || opts.find((o) => /^no\b/i.test(o.text))) || null;
    }
    async function pickOptionViaAI(field, opts, jobDesc, profile) {
      const cached = getLearnedAnswer(field.label) ?? getCached(field.label);
      if (cached !== void 0) {
        const pick = fuzzyPickOption(opts, cached);
        if (pick)
          return pick;
      }
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3e3);
        const token = await getToken();
        if (!token)
          return null;
        const res = await fetch(`${API_BASE}/copilot/pick-option`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          signal: controller.signal,
          body: JSON.stringify({
            label: field.label,
            options: opts.map((o) => o.text),
            profile,
            jobDescription: jobDesc
          })
        });
        clearTimeout(timeout);
        if (!res.ok)
          return null;
        const { index } = await res.json();
        if (index === -1 || index == null || !opts[index])
          return null;
        setCached(field.label, opts[index].text);
        return opts[index];
      } catch (_) {
        return null;
      }
    }
    function visibleOptions() {
      return [...document.querySelectorAll('[role="option"], [role="menuitem"], [role="listitem"]')].filter((o) => {
        const r = o.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }).map((o) => ({ text: o.textContent.trim(), el: o })).filter((o) => o.text);
    }
    async function fillCombobox(field, hint, ctx = {}) {
      const el = field.el;
      if (field.type === "datalist") {
        const listId = el.getAttribute("list");
        const datalist = listId ? document.getElementById(listId) : null;
        if (datalist) {
          const opts2 = [...datalist.options].map((o) => ({ text: (o.label || o.value).trim(), val: o.value })).filter((o) => o.text);
          const pick = fuzzyPickOption(opts2, hint) || await pickOptionViaAI(field, opts2, ctx.jobDesc, ctx.profile);
          if (pick) {
            await typeIn(el, pick.val || pick.text);
            return;
          }
        }
        await typeIn(el, hint);
        return;
      }
      const control = el.closest('[class*="control"]') || el.parentElement?.parentElement;
      if (control && control !== el)
        reactClick(control);
      else
        reactClick(el);
      await sleep(400);
      let opts = visibleOptions();
      if (opts.length > 0) {
        const pick = fuzzyPickOption(opts, hint);
        if (pick) {
          pick.el.click();
          await sleep(100);
          return;
        }
        el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await sleep(150);
      }
      if (control && control !== el)
        reactClick(control);
      else
        reactClick(el);
      await sleep(300);
      await typeIn(el, hint);
      await sleep(450);
      opts = visibleOptions();
      if (opts.length > 0) {
        const pick = fuzzyPickOption(opts, hint) || await pickOptionViaAI(field, opts, ctx.jobDesc, ctx.profile) || opts[0];
        pick.el.click();
        await sleep(100);
        return;
      }
    }
    function reactClick(el) {
      const opts = { bubbles: true, cancelable: true, view: window };
      el.dispatchEvent(new MouseEvent("mousedown", { ...opts, button: 0, buttons: 1 }));
      el.dispatchEvent(new MouseEvent("mouseup", opts));
      el.dispatchEvent(new MouseEvent("click", opts));
    }
    async function probeDropdown(el) {
      const control = el.closest('[class*="control"]') || el.parentElement?.parentElement;
      if (control && control !== el)
        reactClick(control);
      else
        reactClick(el);
      await sleep(400);
      return visibleOptions();
    }
    async function fillOpenEndedWithCache(field, jobDesc, profile) {
      const learned = getLearnedAnswer(field.label);
      if (learned !== void 0)
        return { answer: learned, fromCache: true };
      const cached = getCached(field.label);
      if (cached !== void 0)
        return { answer: cached, fromCache: true };
      const { answer } = await apiCall("/copilot/answer", { question: field.label, jobDescription: jobDesc, learnedAnswers }, profile);
      setCached(field.label, answer);
      return { answer, fromCache: false };
    }
    async function fillSelect(field, jobDesc, profile) {
      const allOpts = [...field.el.options].map((o) => ({ el: o, text: o.textContent.trim() })).filter((o) => o.text);
      const preferred = getLearnedAnswer(field.label) ?? getCached(field.label);
      if (preferred !== void 0) {
        const pick2 = fuzzyPickOption(allOpts, preferred);
        if (pick2) {
          nativeSelectSet(field.el, pick2.el.value);
          fire(field.el, "input");
          fire(field.el, "change");
          return { fromCache: true };
        }
      }
      const pick = await pickOptionViaAI(field, allOpts, jobDesc, profile);
      if (!pick)
        throw new Error(`AI could not match any option for "${field.label}"`);
      nativeSelectSet(field.el, pick.el.value);
      fire(field.el, "input");
      fire(field.el, "change");
      setCached(field.label, pick.text);
      return { fromCache: false };
    }
    async function fillCustomDropdown(field, value, ctx = {}) {
      const el = field.el;
      reactClick(el);
      await sleep(300);
      function collectOptions(root) {
        return [...root.querySelectorAll(
          '[role="option"], [role="menuitem"], [role="listitem"], li[data-value], li[class*="option"], div[class*="option"]'
        )].map((o) => ({ text: o.textContent.trim(), el: o })).filter((o) => o.text);
      }
      const opts = [...collectOptions(el.parentElement || el), ...collectOptions(document.body)];
      const seen = /* @__PURE__ */ new Set();
      const deduped = opts.filter((o) => {
        if (seen.has(o.text))
          return false;
        seen.add(o.text);
        return true;
      });
      const pick = fuzzyPickOption(deduped, value) || await pickOptionViaAI(field, deduped, ctx.jobDesc, ctx.profile);
      if (!pick)
        throw new Error(`custom dropdown: no option for "${value}"`);
      pick.el.click();
      await sleep(100);
    }
    async function applyRuleFix(rule, field, value) {
      if (!value)
        return false;
      const fix = rule.fix;
      let el = fix.selectorOverride && document.querySelector(fix.selectorOverride) || field.el;
      if (fix.waitMs)
        await sleep(fix.waitMs);
      if (el?.id && !el.isConnected) {
        const liveEl = document.getElementById(el.id);
        if (liveEl)
          el = liveEl;
      }
      switch (fix.fillMethod) {
        case "execCommand": {
          el.focus();
          el.select?.();
          const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
          if (nativeSetter) {
            if (el._valueTracker)
              el._valueTracker.setValue("");
            nativeSetter.call(el, String(value));
          } else {
            nativeSet(el, String(value));
          }
          fire(el, "input");
          fire(el, "change");
          el.blur();
          await sleep(50);
          if (el.value !== String(value))
            return false;
          await sleep(150);
          if (el.value !== String(value))
            return false;
          break;
        }
        case "nativeSet":
          nativeSet(el, String(value));
          (fix.eventSequence || ["input", "change"]).forEach((e) => fire(el, e));
          break;
        case "reactClick":
          await fillCombobox(field, value);
          break;
        case "skip":
          return "skip";
        default:
          await typeIn(el, String(value));
      }
      return true;
    }
    function watchForUserEdits(fields) {
      for (const field of fields) {
        if (!field.label || field.label === "(Unlabeled)")
          continue;
        if (SKIP_EEOC.test(field.label))
          continue;
        if (field.type === "file")
          continue;
        const el = field.el;
        const handler = () => {
          let val;
          if (el.type === "checkbox" || el.type === "radio") {
            val = el.checked ? "Yes" : "No";
          } else if (field.type === "combobox" || field.type === "datalist") {
            const container = el.closest('[class*="container"]');
            const singleVal = container?.querySelector('[class*="single-value"]')?.textContent?.trim();
            const multiVals = container ? [...container.querySelectorAll('[class*="multi-value__label"]')].map((e) => e.textContent.trim()) : [];
            val = multiVals.length ? multiVals.join(", ") : singleVal;
          } else {
            val = el.value?.trim();
          }
          if (val) {
            saveLearnedAnswer(field.label, val);
          }
        };
        if (field.type === "combobox" || field.type === "datalist") {
          const container = el.closest('[class*="container"]');
          if (container) {
            const obs = new MutationObserver(() => {
              handler();
            });
            obs.observe(container, { childList: true, subtree: true });
            setTimeout(() => obs.disconnect(), 5 * 60 * 1e3);
            continue;
          }
        }
        el.addEventListener("change", handler, { once: true });
        el.addEventListener("blur", handler, { once: true });
      }
    }
    function getStructuredLocation() {
      const labelEls = [...document.querySelectorAll("div, span, dt, p")].filter((el) => el.children.length === 0 && /^location$/i.test(el.textContent.trim()));
      for (const label of labelEls) {
        const value = label.nextElementSibling?.textContent?.trim();
        if (value && value.length < 100)
          return value;
      }
      return null;
    }
    function getJobDescription() {
      const selectors = [
        '[class*="job-description"]',
        '[class*="jobDescription"]',
        '[class*="job_description"]',
        '[id*="job-description"]',
        ".posting-description",
        "article",
        "main"
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el?.innerText?.length > 200)
          return el.innerText.slice(0, 3e3);
      }
      return document.body.innerText.slice(0, 3e3);
    }
    document.getElementById("__autofill_host")?.remove();
    const host = document.createElement("div");
    host.id = "__autofill_host";
    host.style.cssText = "all:initial;position:fixed!important;top:20px!important;right:20px!important;z-index:2147483647!important;";
    document.documentElement.appendChild(host);
    new MutationObserver(() => {
      if (!document.getElementById("__autofill_host"))
        document.documentElement.appendChild(host);
    }).observe(document.documentElement, { childList: true });
    host.addEventListener("click", (e) => e.stopPropagation());
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
<style>
  *, *::before, *::after { box-sizing: border-box; }
  :host { font-family: system-ui, sans-serif; }
  #fab { all:unset; position:relative; width:52px; height:52px; border-radius:14px; background:#0f172a; border:none;
         box-shadow:0 4px 20px rgba(0,0,0,.35); cursor:pointer; font-size:22px;
         display:flex; align-items:center; justify-content:center; }
  #fab:hover { background:#1e293b; box-shadow:0 6px 28px rgba(0,0,0,.45); }
  #fitBadge { display:none; position:absolute; top:-6px; right:-6px; min-width:20px; height:20px;
              border-radius:10px; background:#94a3b8; color:#fff; font-size:10px; font-weight:700;
              align-items:center; justify-content:center; padding:0 4px; border:2px solid #fff; }
  #fitBadge.good { background:#22c55e; } #fitBadge.mid { background:#f59e0b; }
  #fitBadge.low { background:#ef4444; } #fitBadge.blocker { background:#dc2626; }
  #fitLine { display:none; font-size:11px; font-weight:600; color:#334155; flex-basis:100%; order:2; padding:0 0 2px; }
  #gapLine { display:none; font-size:10.5px; color:#7c3aed; flex-basis:100%; order:3; padding:0 0 2px; }
  #gapLine a { color:#7c3aed; }
  #blockerBanner { display:none; background:#fef2f2; color:#991b1b; font-size:11px; line-height:1.4;
                   padding:6px 12px; border-bottom:1px solid #fecaca; }
  #panel { position:fixed; top:82px; right:20px; width:360px; max-height:72vh;
           background:#fff; border:1px solid #e2e8f0; border-radius:14px;
           box-shadow:0 8px 40px rgba(0,0,0,.18); display:none; flex-direction:column; }
  #panel.open { display:flex; }
  #hdr { display:flex; align-items:center; gap:6px; padding:8px 12px; border-bottom:1px solid #f1f5f9; flex-shrink:0; flex-wrap:wrap; }
  #hdr strong { font-size:13px; }
  #status { flex:1; min-width:100%; font-size:11px; color:#64748b; order:1; padding-top:2px; }
  #list { overflow-y:auto; flex:1; padding:6px 12px; list-style:none; margin:0; }
  .row { display:flex; align-items:flex-start; gap:8px; padding:5px 0; border-bottom:1px dashed #f1f5f9; }
  .row:last-child { border:none; }
  .dot { width:9px; height:9px; border-radius:50%; margin-top:4px; flex-shrink:0; background:#e2e8f0; }
  .done { background:#22c55e; } .skip { background:#94a3b8; } .err { background:#ef4444; } .filling { background:#f59e0b; } .review { background:#f59e0b; outline:2px solid #f59e0b; outline-offset:1px; }
  .lbl { font-size:12px; font-weight:500; }
  .sub { font-size:11px; color:#94a3b8; margin-top:1px; }
  #footer { display:flex; gap:6px; padding:8px 12px; border-top:1px solid #f1f5f9; flex-shrink:0; flex-wrap:wrap; }
  .btn { padding:5px 10px; font-size:12px; border:1px solid #e2e8f0; border-radius:8px; background:#fafafa; cursor:pointer; }
  .btn:hover { background:#f1f5f9; }
  .btn.primary { background:#0f172a; color:#fff; border-color:#0f172a; }
  .btn.primary:hover { background:#1e293b; }
</style>
<button id="fab">\u26A1<span id="fitBadge"></span></button>
<div id="panel">
  <div id="blockerBanner"></div>
  <div id="hdr">
    <strong>Autofill</strong>
    <span id="fitLine"></span>
    <span id="gapLine"></span>
    <span id="status">Ready</span>
    <button class="btn" id="rescan" title="Re-scan" style="margin-left:auto;padding:2px 7px;font-size:13px;">\u21BA</button>
    <button class="btn" id="settings" title="Edit profile" style="padding:2px 7px;font-size:13px;">\u2699</button>
  </div>
  <ul id="list"></ul>
  <div id="footer">
    <button class="btn" id="dry">Dry-run</button>
    <button class="btn primary" id="fill">Fill</button>
    <button class="btn" id="pause">Pause</button>
  </div>
</div>
`;
    const $ = (id) => shadow.getElementById(id);
    const fab = $("fab");
    const panel = $("panel");
    const status = $("status");
    const list = $("list");
    const setStatus = (t) => {
      status.textContent = t;
    };
    fab.addEventListener("click", () => panel.classList.toggle("open"));
    $("rescan").addEventListener("click", () => {
      list.innerHTML = "";
      setStatus("Scanning\u2026");
      autoScan();
      fitChecked = false;
      checkJobFit();
    });
    const APP_ANCHOR = /first.?name|last.?name|email|phone|resume|cover.?letter/i;
    function isApplicationForm(fields) {
      return fields.some(
        (f) => f.el.type === "file" || f.el.type === "email" || APP_ANCHOR.test(f.label) || APP_ANCHOR.test(f.el.placeholder || "") || APP_ANCHOR.test(f.el.name || "")
      );
    }
    function autoScan() {
      if (running)
        return;
      const fields = scanFields();
      if (fields.length === 0)
        return;
      list.innerHTML = "";
      fields.forEach(addRow);
      if (isApplicationForm(fields)) {
        setStatus(`${fields.length} fields \u2014 click Fill`);
        panel.classList.add("open");
      } else {
        setStatus(`${fields.length} fields found`);
      }
    }
    setTimeout(autoScan, 800);
    setTimeout(autoScan, 2e3);
    setTimeout(autoScan, 4e3);
    let fitChecked = false;
    function renderJobFit({ fitScore, fitSummary, blockers, missingKeywords }) {
      const badge = $("fitBadge");
      const banner = $("blockerBanner");
      const fitLine = $("fitLine");
      const gapLine = $("gapLine");
      if (blockers && blockers.length > 0) {
        badge.textContent = "!";
        badge.className = "blocker";
        badge.style.display = "flex";
        banner.textContent = `\u26A0 ${blockers.join(" \xB7 ")}`;
        banner.style.display = "block";
      }
      if (typeof fitScore === "number") {
        if (!blockers?.length) {
          badge.textContent = String(fitScore);
          badge.className = fitScore >= 70 ? "good" : fitScore >= 40 ? "mid" : "low";
          badge.style.display = "flex";
        }
        fitLine.textContent = `${fitScore}% fit${fitSummary ? " \u2014 " + fitSummary : ""}`;
        fitLine.style.display = "block";
      }
      if (missingKeywords && missingKeywords.length > 0) {
        gapLine.textContent = `Missing for this role: ${missingKeywords.slice(0, 5).join(", ")} \u2014 `;
        const link = document.createElement("a");
        link.href = "#";
        link.textContent = "see certifications \u2197";
        link.addEventListener("click", (e) => {
          e.preventDefault();
          chrome.runtime.sendMessage({ type: "OPEN_OPTIONS" });
        });
        gapLine.appendChild(link);
        gapLine.style.display = "block";
      }
    }
    async function checkJobFit() {
      if (fitChecked)
        return;
      const jobDesc = getJobDescription();
      if (!jobDesc || jobDesc.length < 200)
        return;
      fitChecked = true;
      try {
        const stored = await chrome.storage.local.get("profile");
        const profile = stored.profile || {};
        if (!profile.resume && !profile.background)
          return;
        const result = await apiCall("/job-fit", { jobDescription: jobDesc, jobTitle: document.title, jobUrl: location.href, structuredLocation: getStructuredLocation() }, profile);
        renderJobFit(result);
      } catch (_) {
        fitChecked = false;
      }
    }
    setTimeout(checkJobFit, 1800);
    setTimeout(checkJobFit, 4500);
    setTimeout(checkJobFit, 9e3);
    function rowHint(field) {
      if (isResumeField(field))
        return "resume PDF";
      if (isCoverLetterField(field))
        return "cover letter PDF";
      if (isAgreementField(field))
        return "\u2713 agree";
      if (isCountryCodeField(field))
        return "country code";
      if (field.type === "custom-select")
        return field.key ? `dropdown\xB7${field.key}` : "dropdown";
      if (field.type === "combobox")
        return field.key ? `combobox\xB7${field.key}` : "combobox";
      if (field.type === "datalist")
        return field.key ? `datalist\xB7${field.key}` : "datalist";
      if (isOpenEnded(field))
        return "\u{1F916} AI";
      if (field.key)
        return field.key;
      if (field._contextLabel) {
        const k = matchKey(field._contextLabel);
        if (k)
          return k;
        if (SKIP_EEOC.test(field._contextLabel))
          return "EEOC";
        if (AGREE_RE.test(field._contextLabel))
          return "\u2713 agree";
      }
      return "unknown";
    }
    function addRow(field) {
      const li = document.createElement("li");
      li.className = "row";
      li.innerHTML = `
    <div class="dot" data-dot></div>
    <div style="flex:1;min-width:0">
      <div class="lbl">${field.label.slice(0, 80)}</div>
      <div class="sub" data-sub>${rowHint(field)} \xB7 pending</div>
      <a data-link href="#" target="_blank" style="display:none;font-size:11px;color:#6366f1;text-decoration:none;" title="Open tailored resume">\u2197 view resume</a>
    </div>`;
      list.appendChild(li);
      field._dot = li.querySelector("[data-dot]");
      field._sub = li.querySelector("[data-sub]");
      field._link = li.querySelector("[data-link]");
    }
    function setRow(field, state, msg) {
      field._dot.className = `dot ${state}`;
      field._sub.textContent = `${rowHint(field)} \xB7 ${msg}`;
      if (state === "review") {
        field._sub.innerHTML = `${rowHint(field)} \xB7 ${msg} <span style="color:#d97706;text-decoration:underline;cursor:pointer;" data-scroll-to>\u2191 fill it</span>`;
        field._sub.querySelector("[data-scroll-to]").addEventListener("click", (e) => {
          e.preventDefault();
          field.el.scrollIntoView({ behavior: "smooth", block: "center" });
          field.el.focus();
          if (field.type === "combobox") {
            const ctrl = field.el.closest('[class*="control"]') || field.el.parentElement?.parentElement;
            const opts = { bubbles: true, cancelable: true, view: window };
            const target = ctrl && ctrl !== field.el ? ctrl : field.el;
            target.dispatchEvent(new MouseEvent("mousedown", { ...opts, button: 0, buttons: 1 }));
            target.dispatchEvent(new MouseEvent("mouseup", opts));
            target.dispatchEvent(new MouseEvent("click", opts));
          }
        });
      }
    }
    let running = false;
    let paused = false;
    async function run(dryRun) {
      if (running)
        return;
      running = true;
      paused = false;
      await loadCache();
      await loadLearnedAnswers();
      await loadActiveRules();
      const fields = scanFields();
      list.innerHTML = "";
      fields.forEach(addRow);
      setStatus(`${fields.length} fields found`);
      const jobDesc = getJobDescription();
      const DEFAULT_PROFILE = {
        firstName: "",
        lastName: "",
        email: "",
        phone: "",
        pronouns: "",
        city: "",
        state: "",
        country: "",
        postalCode: "",
        linkedin: "",
        github: "",
        portfolio: "",
        educationLevel: "",
        schoolName: "",
        fieldOfStudy: "",
        graduationYear: "",
        workAuth: "Yes",
        sponsorship: "No",
        salary: "",
        heardAbout: "LinkedIn",
        background: "",
        resume: ""
      };
      let profile;
      try {
        const stored = await chrome.storage.local.get("profile");
        profile = { ...DEFAULT_PROFILE, ...stored.profile || {} };
      } catch (e) {
        const msg = e.message || "";
        if (msg.includes("invalidated") || msg.includes("Extension context")) {
          setStatus("\u26A0 Page needs a reload \u2014 press \u2318R");
          running = false;
          return;
        }
        profile = { ...DEFAULT_PROFILE };
      }
      let filled = 0, skipped = 0, errors = 0;
      $("pause").onclick = () => {
        paused = !paused;
        $("pause").textContent = paused ? "Resume" : "Pause";
      };
      for (const field of fields) {
        while (paused)
          await sleep(150);
        if (field.el?.id && !field.el.isConnected) {
          const liveEl = document.getElementById(field.el.id);
          if (liveEl)
            field.el = liveEl;
        }
        field.el.scrollIntoView({ behavior: "smooth", block: "center" });
        field.el.style.outline = "2px solid #f59e0b";
        setRow(field, "filling", "working\u2026");
        try {
          if (!dryRun) {
            const rule = getRuleFor(field);
            if (rule) {
              const value = field.key && profile[field.key] || getLearnedAnswer(field.label) || getCached(field.label);
              const result = await applyRuleFix(rule, field, value);
              if (result === "skip") {
                setRow(field, "skip", `rule:${rule.id}`);
                skipped++;
                field.el.style.outline = "";
                continue;
              }
              if (result === true) {
                setRow(field, "done", `rule:${rule.id}`);
                filled++;
                field.el.style.outline = "";
                continue;
              }
            }
          }
          if (dryRun) {
            setRow(field, "skip", `dry-run \xB7 ${rowHint(field)}`);
            skipped++;
          } else if (isResumeField(field)) {
            setRow(field, "filling", "\u{1F916} tailoring resume\u2026");
            const { pdf, filename: apiFilename, atsMatchRate, baselineMatchRate, missingKeywords } = await apiCall("/resume/tailor", { jobDescription: jobDesc, jobTitle: document.title }, profile);
            const filename = apiFilename || `${profile.firstName || "Resume"}_${profile.lastName || "Resume"}_Resume.pdf`.replace(/\s+/g, "_");
            await attachPdfB64(field.el, pdf, filename);
            await sleep(1e3);
            let atsNote = "";
            if (Number.isFinite(atsMatchRate)) {
              const lift = Number.isFinite(baselineMatchRate) ? ` (was ${baselineMatchRate}%, ${atsMatchRate >= baselineMatchRate ? "+" : ""}${atsMatchRate - baselineMatchRate}pt)` : "";
              const missingNote = missingKeywords?.length ? ` \xB7 missing: ${missingKeywords.slice(0, 4).join(", ")}` : "";
              atsNote = ` \xB7 ${atsMatchRate}% ATS match${lift}${missingNote}`;
            }
            setRow(field, "done", `\u{1F4C4} attached \u2014 \u2197 view${atsNote}`);
            const bytes = Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0));
            const blobUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
            field._link.href = blobUrl;
            field._link.style.display = "inline";
            filled++;
          } else if (isCoverLetterField(field)) {
            const { coverLetterPdfDataUrl } = await chrome.storage.local.get("coverLetterPdfDataUrl");
            if (!coverLetterPdfDataUrl)
              throw new Error("No cover letter uploaded \u2014 add one in extension settings");
            setRow(field, "filling", "attaching cover letter\u2026");
            const res = await fetch(coverLetterPdfDataUrl);
            const blob = await res.blob();
            const name = `${profile.firstName || "Cover"}_${profile.lastName || "Letter"}_CoverLetter.pdf`.replace(/\s+/g, "_");
            await attachFileObj(field.el, new File([blob], name, { type: "application/pdf" }));
            setRow(field, "done", "\u{1F4C4} cover letter attached");
            filled++;
          } else if (isAgreementField(field) || field._contextLabel && AGREE_RE.test(field._contextLabel) && field.type === "checkbox") {
            if (!field.el.checked)
              field.el.click();
            setRow(field, "done", "\u2713 agreed");
            filled++;
          } else if (isCountryCodeField(field)) {
            await fillCountryCode(field);
            setRow(field, "done", "+1 filled");
            filled++;
          } else if (field.type === "custom-select" && field.key) {
            const value = profile[field.key];
            if (!value)
              throw new Error("no data for " + field.key);
            await fillCustomDropdown(field, value, { jobDesc, profile });
            setRow(field, "done", "filled");
            filled++;
          } else if (field.type === "custom-select") {
            setRow(field, "filling", "\u{1F916} asking AI\u2026");
            field.el.click();
            await sleep(300);
            const optEls = [...document.querySelectorAll('[role="option"], [role="menuitem"], [role="listitem"]')].filter((o) => {
              const r = o.getBoundingClientRect();
              return r.width > 0 && r.height > 0;
            });
            if (!optEls.length) {
              field.el.click();
              throw new Error("custom dropdown: no options found");
            }
            const opts = optEls.map((o) => ({ text: o.textContent.trim(), el: o })).filter((o) => o.text);
            if (field.label && field.label !== "(Unlabeled)" && !SKIP_EEOC.test(field.label)) {
              const pick = await pickOptionViaAI(field, opts, jobDesc, profile);
              if (!pick) {
                field.el.click();
                throw new Error(`AI could not match option for "${field.label}"`);
              }
              pick.el.click();
              await sleep(100);
              setRow(field, "done", "\u{1F916} AI filled");
              filled++;
            } else {
              field.el.click();
              setRow(field, "skip", "unknown");
              skipped++;
            }
          } else if (field.type === "combobox" || field.type === "datalist") {
            if (SKIP_EEOC.test(field.label) || SKIP_EEOC.test(field.key || "")) {
              setRow(field, "skip", "EEOC \u2014 skipped");
              skipped++;
            } else if (field.key) {
              const value = profile[field.key];
              if (!value)
                throw new Error("no data for " + field.key);
              await fillCombobox(field, value, { jobDesc, profile });
              setRow(field, "done", "filled");
              filled++;
            } else if (field.label && field.label !== "(Unlabeled)" && !SKIP_EEOC.test(field.label)) {
              const isMultiSelect = field.el.id?.endsWith("[]");
              const learnedVal = getLearnedAnswer(field.label);
              if (isMultiSelect && learnedVal === void 0) {
                setRow(field, "review", "\u26A0\uFE0F fill once \u2192 saved for next run");
                skipped++;
                field.el.closest('[class*="container"]')?.style && (field.el.closest('[class*="container"]').style.outline = "2px solid #f59e0b");
                continue;
              }
              if (isMultiSelect && learnedVal !== void 0) {
                await fillCombobox(field, learnedVal, { jobDesc, profile });
                setRow(field, "done", "\u{1F4E6} from your saved answer");
                filled++;
                field.el.style.outline = "";
                continue;
              }
              const preferred = learnedVal ?? getCached(field.label);
              if (preferred !== void 0) {
                await fillCombobox(field, preferred, { jobDesc, profile });
                setRow(field, "done", "\u{1F4E6} from cache");
                filled++;
                field.el.style.outline = "";
                continue;
              }
              setRow(field, "filling", "\u{1F916} asking AI\u2026");
              const ctrl = field.el.closest('[class*="control"]') || field.el.parentElement?.parentElement;
              if (ctrl && ctrl !== field.el)
                reactClick(ctrl);
              else
                reactClick(field.el);
              await sleep(450);
              const openOpts = visibleOptions();
              if (openOpts.length > 0) {
                const pick = await pickOptionViaAI(field, openOpts, jobDesc, profile);
                if (pick) {
                  pick.el.click();
                  await sleep(100);
                  setRow(field, "done", "\u{1F916} AI filled");
                  filled++;
                  field.el.style.outline = "";
                  continue;
                }
                field.el.blur();
                await sleep(100);
              }
              await fillCombobox(field, field.label, { jobDesc, profile });
              setRow(field, "done", "\u{1F916} filled (best effort)");
              filled++;
            } else {
              setRow(field, "skip", "unknown");
              skipped++;
            }
          } else if (field.key && !SKIP_EEOC.test(field.label) && !SKIP_EEOC.test(field.key)) {
            field._lastFillMethod = "fillStructured";
            await fillStructured(field, profile);
            setRow(field, "done", "filled");
            filled++;
          } else if (isOpenEnded(field)) {
            field._lastFillMethod = "typeIn/AI";
            setRow(field, "filling", "\u{1F916} asking AI\u2026");
            if (field.type === "select-one") {
              const { fromCache } = await fillSelect(field, jobDesc, profile);
              setRow(field, "done", fromCache ? "\u{1F4E6} from cache" : "\u{1F916} AI filled");
            } else {
              const { answer, fromCache } = await fillOpenEndedWithCache(field, jobDesc, profile);
              const dropOpts = await probeDropdown(field.el);
              if (dropOpts.length > 0) {
                const pick = fuzzyPickOption(dropOpts, answer);
                if (pick) {
                  pick.el.click();
                  await sleep(100);
                  setRow(field, "done", fromCache ? "\u{1F4E6} dropdown\xB7cache" : "\u{1F916} dropdown\xB7AI");
                  filled++;
                  field.el.style.outline = "";
                  continue;
                }
                field.el.blur();
                await sleep(100);
              }
              await typeIn(field.el, answer);
              setRow(field, "done", fromCache ? "\u{1F4E6} from cache" : "\u{1F916} AI filled");
            }
            filled++;
          } else if (SKIP_EEOC.test(field.label) || field._contextLabel && SKIP_EEOC.test(field._contextLabel)) {
            setRow(field, "skip", "EEOC \u2014 skipped");
            skipped++;
          } else if (field._contextLabel && !field.key) {
            const inheritedKey = matchKey(field._contextLabel);
            if (inheritedKey) {
              field.key = inheritedKey;
              try {
                await fillStructured(field, profile);
                setRow(field, "done", "filled");
                filled++;
              } catch (e2) {
                setRow(field, "skip", "skip");
                skipped++;
              }
            } else {
              setRow(field, "skip", "unknown");
              skipped++;
            }
          } else {
            setRow(field, "skip", "unknown");
            skipped++;
          }
        } catch (err) {
          setRow(field, "err", err.message);
          errors++;
          if (!dryRun)
            reportFailure(field, err.message, field._lastFillMethod || "unknown");
        } finally {
          field.el.style.outline = "";
        }
        setStatus(`\u2713${filled} \xB7skip${skipped} \xB7err${errors}`);
        if (!dryRun)
          await sleep(80);
      }
      if (!dryRun) {
        watchForUserEdits(fields);
        const reviewFields = fields.filter((f) => f._dot?.className?.includes("review"));
        if (reviewFields.length > 0) {
          const reviewBanner = document.createElement("div");
          reviewBanner.style.cssText = "margin:6px 0 0;padding:8px 10px;background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.4);border-radius:8px;font-size:11px;color:#92400e;";
          reviewBanner.innerHTML = `<strong style="display:block;margin-bottom:4px;">\u26A0\uFE0F Fill these \u2014 saved for next time:</strong>${reviewFields.map((f) => `<div style="margin-top:2px;">\u2022 ${f.label.slice(0, 60)}</div>`).join("")}`;
          list.appendChild(reviewBanner);
        }
        if (filled > 0) {
          const company = (() => {
            try {
              const u = new URL(location.href);
              const ghMatch = u.pathname.match(/^\/(?:embed\/job_app\?.*?for=([^&]+)|([^/]+)\/)/);
              if (u.hostname.includes("greenhouse.io")) {
                const forParam = u.searchParams.get("for");
                if (forParam)
                  return forParam;
                const seg = u.pathname.split("/").find((s) => s && s !== "embed");
                if (seg && seg !== "job_app")
                  return seg;
              }
              if (u.hostname.includes("lever.co"))
                return u.pathname.split("/")[1] || null;
              if (u.hostname.includes("ashbyhq.com"))
                return u.pathname.split("/")[1] || null;
              if (u.hostname.includes("myworkdayjobs.com"))
                return u.hostname.split(".")[0];
              const parts = u.hostname.replace(/^www\./, "").split(".");
              return parts.length >= 2 ? parts[parts.length - 2] : parts[0];
            } catch {
              return null;
            }
          })();
          apiCall("/applications/track", {
            jobUrl: location.href,
            jobTitle: document.title.slice(0, 200),
            company,
            fieldCount: filled + skipped + errors,
            aiUsed: fields.some((f) => isOpenEnded(f)),
            filled,
            skipped,
            errors
          }, {}).then((res) => {
            if (!res?.id)
              return;
            const rowId = res.id;
            const footer = shadow.getElementById("footer");
            const reportBar = document.createElement("div");
            reportBar.style.cssText = "display:flex;align-items:center;gap:6px;width:100%;margin-top:4px;font-size:12px;color:#64748b;";
            reportBar.innerHTML = `
          <span style="flex:1">Did it submit?</span>
          <button class="btn" id="rpt-yes">\u2713 Applied</button>
          <button class="btn" id="rpt-no">\u2717 Failed</button>`;
            footer.appendChild(reportBar);
            const done = (ok) => {
              reportBar.innerHTML = `<span style="color:${ok ? "#22c55e" : "#ef4444"};font-size:12px;flex:1">${ok ? "\u2713 Recorded as submitted" : "\u2717 Recorded as failed"}</span>`;
              apiCall(`/applications/${rowId}/report`, { submitted: ok }, {}).catch(() => {
              });
            };
            shadow.getElementById("rpt-yes").onclick = () => done(true);
            shadow.getElementById("rpt-no").onclick = () => done(false);
            chrome.storage.local.get(["autofill_count", "rated"], ({ autofill_count = 0, rated }) => {
              const newCount = autofill_count + 1;
              chrome.storage.local.set({ autofill_count: newCount });
              if (!rated && newCount === 3) {
                const ratingBar = document.createElement("div");
                ratingBar.style.cssText = "display:flex;align-items:center;gap:8px;width:100%;margin-top:6px;padding:8px 10px;background:rgba(99,102,241,0.12);border:1px solid rgba(99,102,241,0.3);border-radius:8px;font-size:12px;";
                ratingBar.innerHTML = `
              <span style="flex:1;color:#c7d2fe">\u2B50 Enjoying SimplyApply? A quick review helps a lot!</span>
              <a href="https://chromewebstore.google.com/detail/ocdeebjeffdjmfgmclnlphkhfdcdpdkf/reviews" target="_blank"
                style="background:#6366f1;color:#fff;padding:4px 12px;border-radius:6px;font-weight:600;text-decoration:none;white-space:nowrap;font-size:11px;">
                Rate it \u2B50
              </a>
              <button id="rate-dismiss" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:14px;padding:0 2px;">\xD7</button>`;
                footer.appendChild(ratingBar);
                shadow.getElementById("rate-dismiss").onclick = () => {
                  chrome.storage.local.set({ rated: true });
                  ratingBar.remove();
                };
                ratingBar.querySelector("a").onclick = () => chrome.storage.local.set({ rated: true });
              }
            });
          }).catch(() => {
          });
        }
      }
      setStatus(`Done \u2014 \u2713${filled} skip${skipped} err${errors}`);
      running = false;
    }
    function isContextValid() {
      try {
        return !!chrome.runtime?.id;
      } catch (_) {
        return false;
      }
    }
    function handleRunError(err) {
      const msg = err?.message || "";
      if (msg.includes("invalidated") || msg.includes("Extension context") || !isContextValid()) {
        setStatus("\u26A0 Extension reloaded \u2014 refresh page (\u2318R)");
      } else {
        setStatus("\u26A0 " + msg);
      }
      running = false;
    }
    $("dry").addEventListener("click", () => run(true).catch(handleRunError));
    $("fill").addEventListener("click", () => run(false).catch(handleRunError));
    $("settings").addEventListener("click", () => {
      if (!isContextValid()) {
        location.reload();
        return;
      }
      try {
        chrome.runtime.sendMessage({ type: "OPEN_OPTIONS" });
      } catch (_) {
        location.reload();
      }
    });
    return run;
  }
})();
