(() => {
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
    "hire.withgoogle.com"
  ];
  var _loc = location.hostname + location.pathname;
  if (!JOB_HOSTS.some((h) => _loc.includes(h))) {
  } else if (window.__elevateRunning) {
  } else {
    window.__elevateRunning = true;
    main();
  }
  function main() {
    const RESUME_URL = chrome.runtime.getURL("assets/resume.pdf");
    const COVER_URL = chrome.runtime.getURL("assets/cover_letter.pdf");
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
      if (!res.ok)
        throw new Error(`API ${res.status}`);
      return res.json();
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
    const LABEL_TAGS = /* @__PURE__ */ new Set(["LABEL", "LEGEND", "SPAN", "P", "DIV", "H1", "H2", "H3", "H4", "DT", "LI"]);
    const SKIP_EEOC = /gender|lgbtq|race|ethnic|veteran|disability|pronouns|sexual|transgender/i;
    const AGREE_RE = /i agree|i consent|i acknowledge|terms|privacy policy|by (checking|selecting|clicking)/i;
    function cleanText(t) {
      return (t || "").replace(/\s+/g, " ").replace(/^Q\.\s*/i, "").replace(/\s*Question\b.*$/i, "").replace(/\s*Required\b.*$/i, "").replace(/[*:]+$/, "").trim();
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
      { re: /authorized to work|work auth|legally authorized|eligible to work/i, key: "workAuth" },
      { re: /\bphone\b|\bmobile\b|telephone|cell number/i, key: "phone" },
      { re: /\bcountry\b/i, key: "country" },
      { re: /\bstate\b|\bprovince\b/i, key: "state" },
      { re: /\bcity\b/i, key: "city" },
      { re: /zip|postal code/i, key: "postalCode" },
      { re: /linkedin/i, key: "linkedin" },
      { re: /github/i, key: "github" },
      { re: /website|portfolio/i, key: "portfolio" },
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
    async function attachFile(el, assetUrl, filename) {
      const res = await fetch(assetUrl);
      if (!res.ok)
        throw new Error(`fetch ${res.status}`);
      const blob = await res.blob();
      await attachFileObj(el, new File([blob], filename, { type: "application/pdf" }));
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
      if (field.el.tagName === "TEXTAREA")
        return true;
      if (field.type === "text" && field.label.length > 20 && /\?|why|tell|describe|explain|share|what/i.test(field.label))
        return true;
      if (field.label && field.label !== "(Unlabeled)" && !SKIP_EEOC.test(field.label)) {
        if (field.type === "select-one" || field.type === "text")
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
          return { el, label: label || "(Unlabeled)", key, type: (el.type || el.tagName).toLowerCase() };
        });
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
      el.focus();
      nativeSet(el, "");
      fire(el, "input");
      for (const ch of String(value)) {
        nativeSet(el, el.value + ch);
        fire(el, "input");
        await sleep(delay);
      }
      fire(el, "change");
      el.blur();
    }
    async function fillStructured(field, profile) {
      const { el, key, type } = field;
      const value = profile[key] ?? (key === "currentCompany" ? "Google" : null);
      if (value == null)
        throw new Error("no data for " + key);
      if (type === "select-one" || el.tagName === "SELECT") {
        const v = String(value).toLowerCase();
        const opts = [...el.options];
        const pick = opts.find((o) => o.textContent.trim().toLowerCase() === v) || opts.find((o) => o.textContent.trim().toLowerCase().startsWith(v)) || opts.find((o) => o.textContent.trim().toLowerCase().includes(v)) || opts.find((o) => v.includes(o.textContent.trim().toLowerCase()) && o.textContent.trim().length > 1) || v === "yes" && opts.find((o) => /^yes|^true/i.test(o.textContent.trim())) || v === "no" && opts.find((o) => /^no|^false/i.test(o.textContent.trim()));
        if (!pick)
          throw new Error(`no option for "${value}"`);
        nativeSelectSet(el, pick.value);
        fire(el, "input");
        fire(el, "change");
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
    async function fillOpenEndedWithCache(field, jobDesc, profile) {
      const cached = getCached(field.label);
      if (cached !== void 0)
        return { answer: cached, fromCache: true };
      const { answer } = await apiCall("/copilot/answer", { question: field.label, jobDescription: jobDesc }, profile);
      setCached(field.label, answer);
      return { answer, fromCache: false };
    }
    async function fillSelect(field, jobDesc, profile) {
      const cached = getCached(field.label);
      if (cached !== void 0) {
        const opts2 = [...field.el.options];
        const pick2 = opts2.find((o) => o.textContent.trim().toLowerCase() === String(cached).toLowerCase()) || opts2.find((o) => o.value.toLowerCase() === String(cached).toLowerCase());
        if (pick2) {
          nativeSelectSet(field.el, pick2.value);
          fire(field.el, "input");
          fire(field.el, "change");
          return { fromCache: true };
        }
      }
      const opts = [...field.el.options].map((o) => o.textContent.trim()).filter(Boolean);
      const question = `${field.label} (choose the best option from: ${opts.join(", ")})`;
      const { answer } = await apiCall("/copilot/answer", { question, jobDescription: jobDesc }, profile);
      const normalAnswer = answer.toLowerCase();
      const pick = [...field.el.options].find(
        (o) => o.textContent.trim().toLowerCase() === normalAnswer || normalAnswer.includes(o.textContent.trim().toLowerCase()) || o.textContent.trim().toLowerCase().includes(normalAnswer)
      );
      if (!pick)
        throw new Error(`AI answer "${answer}" matched no option`);
      nativeSelectSet(field.el, pick.value);
      fire(field.el, "input");
      fire(field.el, "change");
      setCached(field.label, pick.textContent.trim());
      return { fromCache: false };
    }
    async function fillCustomDropdown(el, value) {
      el.click();
      await sleep(300);
      const v = String(value).toLowerCase();
      function findOption(root) {
        const candidates = [...root.querySelectorAll(
          '[role="option"], [role="menuitem"], [role="listitem"], li[data-value], li[class*="option"], div[class*="option"]'
        )];
        return candidates.find((o) => o.textContent.trim().toLowerCase() === v) || candidates.find((o) => o.textContent.trim().toLowerCase().startsWith(v)) || candidates.find((o) => o.textContent.trim().toLowerCase().includes(v)) || candidates.find((o) => v.includes(o.textContent.trim().toLowerCase()) && o.textContent.trim().length > 1);
      }
      let pick = findOption(el.parentElement || el) || findOption(document.body);
      if (!pick)
        throw new Error(`custom dropdown: no option for "${value}"`);
      pick.click();
      await sleep(100);
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
          const val = el.type === "checkbox" || el.type === "radio" ? el.checked ? "Yes" : "No" : el.value?.trim();
          if (val)
            setCached(field.label, val);
        };
        el.addEventListener("change", handler, { once: true });
        el.addEventListener("blur", handler, { once: true });
      }
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
  #fab { all:unset; width:52px; height:52px; border-radius:14px; background:#0f172a; border:none;
         box-shadow:0 4px 20px rgba(0,0,0,.35); cursor:pointer; font-size:22px;
         display:flex; align-items:center; justify-content:center; }
  #fab:hover { background:#1e293b; box-shadow:0 6px 28px rgba(0,0,0,.45); }
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
  .done { background:#22c55e; } .skip { background:#94a3b8; } .err { background:#ef4444; } .filling { background:#f59e0b; }
  .lbl { font-size:12px; font-weight:500; }
  .sub { font-size:11px; color:#94a3b8; margin-top:1px; }
  #footer { display:flex; gap:6px; padding:8px 12px; border-top:1px solid #f1f5f9; flex-shrink:0; flex-wrap:wrap; }
  .btn { padding:5px 10px; font-size:12px; border:1px solid #e2e8f0; border-radius:8px; background:#fafafa; cursor:pointer; }
  .btn:hover { background:#f1f5f9; }
  .btn.primary { background:#0f172a; color:#fff; border-color:#0f172a; }
  .btn.primary:hover { background:#1e293b; }
</style>
<button id="fab">\u26A1</button>
<div id="panel">
  <div id="hdr">
    <strong>Autofill</strong>
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
    }
    let running = false;
    let paused = false;
    async function run(dryRun) {
      if (running)
        return;
      running = true;
      paused = false;
      await loadCache();
      const fields = scanFields();
      list.innerHTML = "";
      fields.forEach(addRow);
      setStatus(`${fields.length} fields found`);
      const jobDesc = getJobDescription();
      const DEFAULT_PROFILE = {
        firstName: "Sushanth",
        lastName: "Tiruvaipati",
        email: "t.sushanth@gmail.com",
        phone: "+1 425-628-4887",
        city: "San Jose",
        state: "California",
        country: "United States",
        postalCode: "95101",
        linkedin: "https://www.linkedin.com/in/tsushanth",
        github: "https://github.com/tsushanth",
        portfolio: "https://kreativekoala.llc",
        educationLevel: "Master's Degree",
        schoolName: "Carnegie Mellon University",
        fieldOfStudy: "Information Networking",
        graduationYear: "2011",
        workAuth: "Yes",
        sponsorship: "No",
        salary: "150000",
        heardAbout: "LinkedIn",
        background: `Sushanth Tiruvaipati is a software engineer with 10+ years at Google and an indie developer who has shipped 70+ iOS/Android apps generating real revenue. At Google he worked across Ads, Cloud AI, Play, and YouTube on large-scale distributed systems. Strong in TypeScript, Swift, Kotlin, Python, Go, C++, and cloud infrastructure. Located in Bay Area, CA, open to relocation. Compensation floor $150k base.`,
        resume: `SUSHANTH TIRUVAIPATI
Bay Area, CA \xB7 t.sushanth@gmail.com \xB7 425-628-4887 \xB7 linkedin.com/in/tsushanth

EXPERIENCE
Software Engineer \xB7 Google | Sep 2015 \u2013 Present
- Large-scale distributed systems across Ads, Cloud AI, Play, YouTube
Founder & Sole Engineer \xB7 KreativeKoala Solutions LLC | 2021 \u2013 Present
- Built and shipped 70+ iOS/Android apps end-to-end
Software Development Engineer \xB7 Microsoft | Nov 2012 \u2013 Feb 2015
Software Development Engineer \xB7 Amazon | Oct 2011 \u2013 Oct 2012

EDUCATION
Carnegie Mellon University \u2014 M.S., Information Networking \xB7 2011`
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
        field.el.scrollIntoView({ behavior: "smooth", block: "center" });
        field.el.style.outline = "2px solid #f59e0b";
        setRow(field, "filling", "working\u2026");
        try {
          if (dryRun) {
            setRow(field, "skip", `dry-run \xB7 ${rowHint(field)}`);
            skipped++;
          } else if (isResumeField(field)) {
            setRow(field, "filling", "\u{1F916} tailoring resume\u2026");
            const { pdf, filename } = await apiCall("/resume/tailor", { jobDescription: jobDesc, jobTitle: document.title }, profile);
            await attachPdfB64(field.el, pdf, filename);
            setRow(field, "done", "\u{1F4C4} attached \u2014 \u2197 view");
            const bytes = Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0));
            const blobUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
            field._link.href = blobUrl;
            field._link.style.display = "inline";
            filled++;
          } else if (isCoverLetterField(field)) {
            setRow(field, "filling", "attaching cover letter\u2026");
            await attachFile(field.el, COVER_URL, "Sushanth_Tiruvaipati_CoverLetter.pdf");
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
            await fillCustomDropdown(field.el, value);
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
            const opts = optEls.map((o) => o.textContent.trim()).filter(Boolean);
            field.el.click();
            await sleep(100);
            if (field.label && field.label !== "(Unlabeled)" && !SKIP_EEOC.test(field.label)) {
              const question = `${field.label} (choose the best option from: ${opts.join(", ")})`;
              const { answer } = await apiCall("/copilot/answer", { question, jobDescription: jobDesc }, profile);
              await fillCustomDropdown(field.el, answer);
              setCached(field.label, answer);
              setRow(field, "done", "\u{1F916} AI filled");
              filled++;
            } else {
              setRow(field, "skip", "unknown");
              skipped++;
            }
          } else if (field.key) {
            await fillStructured(field, profile);
            setRow(field, "done", "filled");
            filled++;
          } else if (isOpenEnded(field)) {
            setRow(field, "filling", "\u{1F916} asking AI\u2026");
            if (field.type === "select-one") {
              const { fromCache } = await fillSelect(field, jobDesc, profile);
              setRow(field, "done", fromCache ? "\u{1F4E6} from cache" : "\u{1F916} AI filled");
            } else {
              const { answer, fromCache } = await fillOpenEndedWithCache(field, jobDesc, profile);
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
        } finally {
          field.el.style.outline = "";
        }
        setStatus(`\u2713${filled} \xB7skip${skipped} \xB7err${errors}`);
        if (!dryRun)
          await sleep(80);
      }
      if (!dryRun) {
        watchForUserEdits(fields);
        if (filled > 0) {
          const company = (() => {
            try {
              return new URL(location.href).hostname.replace(/^www\./, "").split(".")[0];
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
  }
})();
