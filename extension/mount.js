(()=>{if(window.__autofillMounted)return;window.__autofillMounted=true;const sleep=e=>new Promise(t=>setTimeout(t,e)),fire=(e,t)=>e.dispatchEvent(new Event(t,{bubbles:!0}));const host=document.createElement("div");host.id="__autofill_widget_host",host.style.position="fixed",host.style.inset="auto 20px 20px auto",host.style.zIndex=2147483647,document.documentElement.appendChild(host);const shadow=host.attachShadow({mode:"open"});shadow.innerHTML=`
    <style>
      .wrap{ position:relative; }
      .btn{ all:initial; width:56px;height:56px;border-radius:14px;display:inline-flex;align-items:center;justify-content:center;
            background:#fff;border:1px solid #e5e7eb;box-shadow:0 8px 28px rgba(0,0,0,.18);cursor:pointer;font:16px system-ui; }
      .btn:hover{ box-shadow:0 10px 36px rgba(0,0,0,.22); }
      .panel{ position:fixed; right:20px; bottom:90px; width:360px; max-height:70vh; overflow:auto; background:#fff; border:1px solid #e5e7eb;
              border-radius:14px; box-shadow:0 12px 44px rgba(0,0,0,.22); display:none; }
      .panel.open{ display:block; }
      .hdr{ display:flex; align-items:center; gap:8px; padding:10px 12px; border-bottom:1px solid #f1f5f9; }
      .lst{ list-style:none; margin:0; padding:8px 12px; }
      .row{ display:flex; gap:8px; align-items:flex-start; padding:6px 0; border-bottom:1px dashed #f1f5f9; }
      .row:last-child{ border-bottom:none; }
      .st{ width:10px; height:10px; border-radius:50%; margin-top:4px; }
      .s-pending{ background:#e5e7eb; } .s-filling{ background:#fbbf24; } .s-done{ background:#22c55e; }
      .s-skip{ background:#94a3b8; } .s-error{ background:#ef4444; }
      .footer{ display:flex; gap:8px; padding:10px 12px; border-top:1px solid #f1f5f9; }
      .smallbtn{ padding:6px 10px; border:1px solid #e5e7eb; border-radius:8px; background:#fafafa; cursor:pointer; }
      mark{ background:#fef3c7; }
      .live{ position:absolute; left:-9999px; top:auto; width:1px; height:1px; overflow:hidden; }
    </style>
    <div class="wrap">
      <button class="btn" id="toggle">⚡</button>
      <div class="panel" id="panel">
        <div class="hdr">
          <strong style="font:14px system-ui">Autofill</strong>
          <span id="summary" style="margin-left:auto;font:13px system-ui">Ready</span>
        </div>
        <ul class="lst" id="list"></ul>
        <div class="footer">
          <button class="smallbtn" id="dry">Dry-run</button>
          <button class="smallbtn" id="run">Fill</button>
          <button class="smallbtn" id="pause">Pause</button>
          <button class="smallbtn" id="settings">Settings</button>
        </div>
      </div>
      <div class="live" aria-live="polite" id="live"></div>
    </div>
  `;const ui={panel:shadow.getElementById("panel"),toggleBtn:shadow.getElementById("toggle"),runBtn:shadow.getElementById("run"),dryBtn:shadow.getElementById("dry"),pauseBtn:shadow.getElementById("pause"),settingsBtn:shadow.getElementById("settings"),list:shadow.getElementById("list"),summary:shadow.getElementById("summary"),live:shadow.getElementById("live"),setSummary(e){this.summary.textContent=e,this.live.textContent=e},addRow(e){const t=document.createElement("li");t.className="row",t.innerHTML=`
        <div class="st s-pending" data-st></div>
        <div class="p">
          <div><mark>${(e.label||"").replace(/\s+/g," ").slice(0,120)||"(Unlabeled field)"}</mark></div>
          <div style="font:12px system-ui;color:#4b5563">${e.key||"unknown"} · <span data-msg>pending</span></div>
        </div>`,this.list.appendChild(t),e._row=t},setRow(e,t,s){const n=e._row.querySelector("[data-st]"),o=e._row.querySelector("[data-msg]");n.className=`st s-${t}`,o.textContent=s}};ui.toggleBtn.addEventListener("click",(()=>ui.panel.classList.toggle("open"))),ui.settingsBtn.addEventListener("click",(()=>chrome.runtime.sendMessage({type:"OPEN_OPTIONS"})));function buildInventory(e=document){const t=[...e.querySelectorAll("input, select, textarea")].filter((e=>e.offsetParent&&!e.disabled)),s=e=>{const t=e.id&&e.querySelector(`label[for="${CSS.escape(e.id)}"]`);if(t)return t.textContent.trim();const s=e.closest("label");if(s)return s.textContent.trim();const n=e.getAttribute("aria-label")||e.placeholder||e.name||e.id||"";return n.trim()},n=(e,t)=>{const s=`${t} ${e.name} ${e.id}`.toLowerCase();return/\b(first[\s_-]*name)\b/.test(s)?"firstName":/\b(last[\s_-]*name|surname|family)\b/.test(s)?"lastName":/\bemail\b/.test(s)?"email":/\bphone|mobile\b/.test(s)?"phone":/\blinkedin\b/.test(s)?"linkedin":/\bgit(hub)?\b/.test(s)?"github":/\bportfolio|website|url\b/.test(s)?"portfolio":/\bcity|location\b/.test(s)?"location":/\bauthori(s|z)ed|work auth|work authorization\b/.test(s)?"workAuth":null};return t.map(((e,t)=>{const o=s.call(document,e),i=n(e,o),l=(e.type||e.tagName).toLowerCase();return{ix:t,el:e,label:o,key:i,type:l,status:"pending"}}))}const typeIn=async(e,t,s=8)=>{e.focus(),e.value="",fire(e,"input");for(const n of String(t))e.value+=n,fire(e,"input"),await sleep(s);fire(e,"change"),e.blur(),fire(e,"blur")};async function fillField(e,t){const{el:s,type:n,key:o}=e;if(!o||!(o in t))throw new Error("no data");const i=t[o];if("select-one"===n||"SELECT"===s.tagName){const e=[...s.options],t=e.find((e=>e.textContent.trim().toLowerCase()===String(i).toLowerCase()))||e.find((e=>String(i).toLowerCase().includes(e.value.toLowerCase())));if(t)return s.value=t.value,void fire(s,"change");throw new Error("no matching option")}if("checkbox"===n||"radio"===n){const e=!!i&&"no"!==String(i).toLowerCase();return void(s.checked!==e&&s.click())}if("file"===n)throw s.scrollIntoView({behavior:"smooth",block:"center"}),s.focus(),new Error("needs user file selection");await typeIn(s,i)}function validate(e,t){const s=e.el,n=e.type,o=e.key,i=String(t[o]??"").trim();if(!i)return!1;if("select-one"===n||"SELECT"===s.tagName){const e=s.selectedOptions[0]?.textContent?.trim()||"";return e.toLowerCase().includes(i.toLowerCase())}if("checkbox"===n||"radio"===n){const e=!!i&&"no"!==i.toLowerCase();return s.checked===e}return String(s.value||"").trim()===i}async function runAutofill({profile:e,dryRun:t=!1,delay:s=120}){const n=buildInventory();ui.list.innerHTML="",n.forEach(ui.addRow.bind(ui)),ui.setSummary(`Found ${n.length} fields. ${t?"Dry-run.":"Starting…"}`);let o=0,i=0,l=0,a=!1;ui.pauseBtn.textContent="Pause";const r=()=>{a=!a,ui.pauseBtn.textContent=a?"Resume":"Pause"};ui.pauseBtn.onclick=r;for(const r of n){for(;a;)await sleep(150);r.el.scrollIntoView({behavior:"smooth",block:"center"}),r.el.style.outline="2px solid #f59e0b",ui.setRow(r,"filling","filling…");try{if(t||!r.key)ui.setRow(r,"skip",r.key?"dry-run":"unknown field"),i++;else{await fillField(r,e),await sleep(s);const t=validate(r,e);if(!t)throw new Error("validation failed");ui.setRow(r,"done","filled"),o++}}catch(e){ui.setRow(r,"error",e.message||"error"),l++}finally{r.el.style.outline=""}ui.setSummary(`Filled: ${o} · Skipped: ${i} · Errors: ${l}`)}ui.setSummary(`Done — Filled ${o}, Skipped ${i}, Errors ${l}`)}ui.dryBtn.addEventListener("click",async()=>{const {profile:e}=await chrome.runtime.sendMessage({type:"GET_PROFILE"});runAutofill({profile:e,dryRun:!0})}),ui.runBtn.addEventListener("click",async()=>{const {profile:e}=await chrome.runtime.sendMessage({type:"GET_PROFILE"});runAutofill({profile:e,dryRun:!1,delay:120})});const triggerRoute=()=>{};const wrap=e=>{const t=history[e];history[e]=function(){const e=t.apply(this,arguments);return window.dispatchEvent(new Event("locationchange")),e}};wrap("pushState"),wrap("replaceState"),window.addEventListener("popstate",(()=>window.dispatchEvent(new Event("locationchange")))),window.addEventListener("locationchange",triggerRoute),triggerRoute()})();