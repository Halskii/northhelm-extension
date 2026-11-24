// Job Autofill — fill engine. Finds form controls (including inside open shadow
// roots), works out what each one asks for, and fills it from the saved profile
// in a way React/Angular/Workday-style apps notice. Never clicks Submit/Next.
(() => {
  if (window.__jobAutofill) return;
  const M = window.__JAF_M;
  const AD = window.__JAF_ADAPTERS;
  const { norm } = M;

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const DEFAULT_SETTINGS = { overwrite: false, fillEeo: false, workdayAddEntries: true, highlight: true };

  // ---------------------------------------------------------------------------
  // Storage
  // ---------------------------------------------------------------------------
  async function loadStore(profileId) {
    if (window.__JAF_TEST_STORE) return window.__JAF_TEST_STORE;
    return window.JAF_STORE.loadForFill(profileId);
  }

  // ---------------------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------------------
  const parentOf = (n) => n.parentElement || (n.getRootNode && n.getRootNode().host) || null;

  function visible(el) {
    if (!el || !el.isConnected) return false;
    if (el.getClientRects().length === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && parseFloat(cs.opacity || "1") > 0.01;
  }

  // Ordered deep traversal that also descends into open shadow roots.
  function deepCollect(root, test, out = []) {
    const kids = root.children || [];
    for (const child of kids) {
      if (test(child)) out.push(child);
      if (child.shadowRoot) deepCollect(child.shadowRoot, test, out);
      if (child.tagName === "TEMPLATE") continue;
      deepCollect(child, test, out);
    }
    return out;
  }

  const CONTROL_TAGS = new Set(["INPUT", "SELECT", "TEXTAREA"]);
  const SKIP_TYPES = new Set(["hidden", "submit", "button", "reset", "image", "password", "range", "color"]);
  const isControl = (el) => CONTROL_TAGS.has(el.tagName) ||
    (el.tagName === "BUTTON" && el.getAttribute("aria-haspopup") === "listbox") ||
    (el.getAttribute && el.getAttribute("role") === "combobox" && !CONTROL_TAGS.has(el.tagName));

  const EXCLUDE_TEXT = "script, style, noscript, select, option, textarea, [role=listbox], [role=option], .jaf-toast";

  function textOf(node, excludeEls = [], max = 400) {
    if (!node) return "";
    const parts = [];
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) { const t = c.nodeValue.trim(); if (t) parts.push(t); continue; }
        if (c.nodeType !== 1) continue;
        if (excludeEls.includes(c)) continue;
        if (c.matches && c.matches(EXCLUDE_TEXT)) continue;
        if (c.matches && c.matches("input, button")) continue;
        if (c.getAttribute && c.getAttribute("aria-hidden") === "true") continue;
        walk(c);
        if (c.shadowRoot) walk(c.shadowRoot);
      }
    };
    walk(node);
    return parts.join(" ").replace(/\s+/g, " ").slice(0, max).trim();
  }

  function byIds(ids, rootNode) {
    const root = rootNode || document;
    return ids.split(/\s+/).map(id => (root.getElementById ? root.getElementById(id) : null) || document.getElementById(id)).filter(Boolean);
  }

  function countControls(node) {
    const set = new Set();
    deepCollect(node, (e) => {
      if (!isControl(e)) return false;
      if (e.tagName === "INPUT" && SKIP_TYPES.has(e.type)) return false;
      set.add((e.type === "radio" || e.type === "checkbox") && e.name ? "n:" + e.name : e);
      return false;
    });
    return set.size;
  }

  // Text of the nearest wrapper that holds only this field (or this group).
  function containerText(el, groupEls = [el], maxControls = 1, levels = 5) {
    let node = el;
    for (let i = 0; i < levels; i++) {
      node = parentOf(node);
      if (!node || node === document.body || node === document.documentElement || node.nodeType !== 1) break;
      if (node.tagName === "FORM") break;
      if (countControls(node) > maxControls) break;
      const t = textOf(node, groupEls);
      if (t && t.length > 1) return t;
    }
    return "";
  }

  function directLabel(el) {
    const root = el.getRootNode();
    const lb = el.getAttribute("aria-labelledby");
    if (lb) { const t = byIds(lb, root).map(n => textOf(n, [el])).join(" ").trim(); if (t) return t; }
    if (el.labels && el.labels.length) { const t = [...el.labels].map(l => textOf(l, [el])).join(" ").trim(); if (t) return t; }
    const al = el.getAttribute("aria-label"); if (al && al.trim()) return al.trim();
    const wrap = el.closest && el.closest("label"); if (wrap) { const t = textOf(wrap, [el]); if (t) return t; }
    // Shadow-DOM web components (SmartRecruiters, Oracle): label lives on the host.
    const host = root && root.host;
    if (host) {
      const h = host.getAttribute("label") || host.getAttribute("aria-label") || host.getAttribute("placeholder");
      if (h) return h;
      if (host.labels && host.labels.length) return textOf(host.labels[0]);
    }
    return "";
  }

  function labelFor(el) {
    let t = directLabel(el);
    if (!t) t = containerText(el);
    if (!t) t = el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("data-placeholder") || "";
    // Date parts labelled only "Month"/"Year": add the group's label ("Start date").
    if (/^(month|year|day|mm|yyyy|dd)\b\W*$/i.test(t.trim()) || /^(select one|select|choose)$/i.test(t.trim())) {
      const fs = el.closest("fieldset");
      const legend = fs && fs.querySelector("legend");
      const g = (legend && textOf(legend)) || containerText(el, [el], 3, 6);
      if (g) t = g + " " + t;
    }
    return t;
  }

  function attrText(el) {
    const a = ["name", "id", "data-automation-id", "autocomplete", "data-qa", "data-testid", "data-field", "formcontrolname", "ng-model", "placeholder"];
    let s = a.map(k => el.getAttribute && el.getAttribute(k)).filter(Boolean).join(" ");
    // A few levels of wrapper automation ids (Workday: formField-startDate…)
    let n = parentOf(el);
    for (let i = 0; i < 3 && n && n.getAttribute; i++, n = parentOf(n)) {
      const d = n.getAttribute("data-automation-id"); if (d) s += " " + d;
    }
    return s.replace(/([a-z])([A-Z])/g, "$1 $2");
  }

  function isRequired(el, label) {
    return !!(el.required || el.getAttribute("aria-required") === "true" || /\*\s*$|\*\s*\(?required|\(required\)|^\*/i.test(label || "") ||
      (el.closest && el.closest('[aria-required="true"], [data-required="true"]')));
  }

  // ---------------------------------------------------------------------------
  // Section detection (work experience vs education vs everything else)
  // ---------------------------------------------------------------------------
  const JOB_RE = /work ?experience|employment (history|experience)|^employment$|work ?history|job ?history|professional experience|previous (jobs|positions|employment)|^(my )?experiences?\b/i;
  const NOT_SECTION_RE = /equal|opportunit|eeo|voluntary|self.?ident|disclosure|demographic/i;
  const EDU_RE = /education|academic|schools?\b/i;

  function sectionFromAttrs(el) {
    let n = el;
    for (let i = 0; i < 14 && n && n.getAttribute; i++, n = parentOf(n)) {
      if (n === document.body) break;
      const s = [n.id, n.getAttribute("data-automation-id"), typeof n.className === "string" ? n.className : "", n.getAttribute("aria-label"), n.getAttribute("data-qa")].filter(Boolean).join(" ");
      if (!s || NOT_SECTION_RE.test(s)) continue;
      if (/work-?experience|employment|work-?history|job-?history|experience-?\d/i.test(s)) return { sec: "job", node: n };
      if (/education|school-?\d|academic/i.test(s)) return { sec: "edu", node: n };
    }
    return null;
  }

  function buildHeadingIndex() {
    return deepCollect(document.body, e => /^(H[1-6]|LEGEND)$/.test(e.tagName) || (e.getAttribute && e.getAttribute("role") === "heading"))
      .map(h => ({ h, t: textOf(h, [], 80) }))
      .filter(x => x.t);
  }

  function sectionFromHeadings(el, headings) {
    let last = null;
    for (const x of headings) {
      const pos = x.h.compareDocumentPosition(el);
      if (pos & Node.DOCUMENT_POSITION_DISCONNECTED) continue;
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING || pos & Node.DOCUMENT_POSITION_CONTAINED_BY) last = x; else break;
    }
    if (!last) return "top";
    if (NOT_SECTION_RE.test(last.t)) return "top";
    if (JOB_RE.test(last.t)) return "job";
    if (EDU_RE.test(last.t)) return "edu";
    return "top";
  }

  function entryIdFrom(el) {
    let n = el;
    for (let i = 0; i < 10 && n && n.getAttribute; i++, n = parentOf(n)) {
      const s = (n.id || "") + " " + (n.getAttribute("data-automation-id") || "");
      const m = s.match(/(?:workExperience|education|experience|school|degree|discipline|(?:start|end)-(?:month|year))-{1,2}(\d+)/i);
      if (m) return m[1];
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Field collection
  // ---------------------------------------------------------------------------
  function optionLabel(input) {
    if (input.labels && input.labels.length) return textOf(input.labels[0], [input]);
    const al = input.getAttribute("aria-label"); if (al) return al;
    const wrap = input.closest("label"); if (wrap) return textOf(wrap, [input]);
    const sib = input.nextElementSibling; if (sib) return textOf(sib);
    return input.value || "";
  }

  function groupQuestion(els) {
    const first = els[0];
    const fs = first.closest("fieldset");
    if (fs && els.every(e => fs.contains(e))) {
      const lg = fs.querySelector("legend"); if (lg && textOf(lg)) return textOf(lg);
    }
    const rg = first.closest('[role="radiogroup"], [role="group"]');
    if (rg) {
      const lb = rg.getAttribute("aria-labelledby");
      if (lb) { const t = byIds(lb, rg.getRootNode()).map(n => textOf(n)).join(" "); if (t) return t; }
      if (rg.getAttribute("aria-label")) return rg.getAttribute("aria-label");
    }
    // Lowest common wrapper, then climb while it only holds this group.
    let node = first;
    while (node && !els.every(e => node.contains(e))) node = parentOf(node);
    const labels = els.flatMap(e => [e, ...(e.labels ? [...e.labels] : []), e.closest("label")].filter(Boolean));
    for (let i = 0; node && i < 4; i++, node = parentOf(node)) {
      if (node === document.body || node.tagName === "FORM") break;
      if (countControls(node) > 1) break;
      const t = textOf(node, labels);
      if (t) return t;
    }
    return "";
  }

  function collectFields() {
    const out = [];
    const raw = deepCollect(document.body, isControl);
    const seenGroups = new Set();

    for (const el of raw) {
      if (el.closest && el.closest("[data-jaf-ignore], .jaf-toast")) continue;
      const tag = el.tagName;
      const type = (el.getAttribute("type") || "").toLowerCase();
      if (tag === "INPUT" && SKIP_TYPES.has(type)) continue;
      if (el.disabled) continue;

      if (tag === "INPUT" && (type === "radio" || type === "checkbox")) {
        const name = el.name;
        if (name && seenGroups.has(type + name)) continue;
        const group = name ? raw.filter(x => x.tagName === "INPUT" && x.type === type && x.name === name && x.getRootNode() === el.getRootNode()) : [el];
        if (name) seenGroups.add(type + name);
        const vis = group.filter(g => visible(g) || (g.labels && [...g.labels].some(visible)) || visible(g.closest("label")) || visible(g.parentElement));
        if (!vis.length) continue;
        if (type === "radio" || group.length > 1) {
          const label = groupQuestion(vis);
          out.push({ kind: type === "radio" ? "radio" : "checkgroup", el: vis[0], els: vis, options: vis.map(optionLabel), label, attrs: attrText(vis[0]) + " " + name });
        } else {
          const label = optionLabel(el) || labelFor(el);
          out.push({ kind: "checkbox", el, els: [el], label, attrs: attrText(el) });
        }
        continue;
      }

      if (tag === "INPUT" && type === "file") {
        out.push({ kind: "file", el, label: labelFor(el) || containerText(el, [el], 1, 7), attrs: attrText(el) });
        continue;
      }

      if (!visible(el)) continue;
      if (el.readOnly && el.getAttribute("role") !== "combobox" && el.getAttribute("aria-haspopup") !== "listbox") continue;
      if (type === "search" && !el.closest("form") && !el.closest('[data-automation-id*="multiselect"]')) continue;

      let kind;
      if (tag === "SELECT") kind = "select";
      else if (tag === "TEXTAREA") kind = "textarea";
      else if (tag === "BUTTON" || (el.getAttribute("role") === "combobox" && tag !== "INPUT")) kind = "listbox";
      else if (el.getAttribute("role") === "combobox" || el.getAttribute("aria-autocomplete") === "list" || el.getAttribute("data-automation-id") === "searchBox" || /select__input|react-select/.test(el.id + " " + el.className)) kind = "combobox";
      else kind = "text";
      if (el.isContentEditable && tag !== "INPUT") kind = "textarea";

      out.push({ kind, el, label: labelFor(el), attrs: attrText(el) });
    }

    // Yes/No button groups (Ashby and others render these as plain buttons)
    const buttons = deepCollect(document.body, e => e.tagName === "BUTTON" && /^(yes|no)$/i.test(e.textContent.trim()) && visible(e));
    const parents = new Set(buttons.map(b => b.parentElement));
    for (const p of parents) {
      if (!p) continue;
      const btns = [...p.querySelectorAll(":scope > button")].filter(visible);
      if (btns.length < 2 || btns.length > 5) continue;
      if (!btns.some(b => /^yes$/i.test(b.textContent.trim())) || !btns.some(b => /^no$/i.test(b.textContent.trim()))) continue;
      const label = containerText(p, btns, 0, 4) || containerText(p, btns, 1, 4);
      out.push({ kind: "buttons", el: btns[0], els: btns, options: btns.map(b => b.textContent.trim()), label, attrs: "" });
    }

    // Sections + entry indexes
    const headings = buildHeadingIndex();
    const entryRanks = { job: [], edu: [] };
    for (const f of out) {
      const a = sectionFromAttrs(f.el);
      f.section = a ? a.sec : sectionFromHeadings(f.el, headings);
      f.entryId = f.section === "top" ? null : entryIdFrom(f.el);
      if (f.entryId != null) {
        const list = entryRanks[f.section];
        if (!list.includes(f.entryId)) list.push(f.entryId);
      }
      f.required = isRequired(f.el, f.label);
    }
    for (const f of out) {
      if (f.entryId != null) f.entryIndex = entryRanks[f.section].indexOf(f.entryId);
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Matching a field to a profile key
  // ---------------------------------------------------------------------------
  function customAnswerFor(f, profile) {
    const label = norm(f.label);
    if (!label) return null;
    for (const c of profile.customAnswers || []) {
      if (!c || !c.match || c.answer == null || c.answer === "") continue;
      const m = String(c.match).trim();
      let ok = false;
      if (/^\/.+\/[a-z]*$/.test(m)) {
        try { const body = m.slice(1, m.lastIndexOf("/")); ok = new RegExp(body, "i").test(f.label); } catch (_) {}
      } else ok = label.includes(norm(m));
      if (ok) return String(c.answer);
    }
    return null;
  }

  function keyFor(f, adapter, settings) {
    // 1) site hints (exact selectors for known sites)
    for (const [sel, key] of adapter.hints || []) {
      let hit = false;
      try { hit = f.el.matches(sel); } catch (_) {}
      if (!hit) continue;
      if (key.endsWith("File")) { if (f.kind === "file") return key; continue; }
      if (!M.keyAllowsKind(key, f.kind)) continue;
      if (key.startsWith("eeo.") && !settings.fillEeo) return "__eeo";
      return key;
    }
    // 2) file inputs
    if (f.kind === "file") {
      const t = norm(f.label + " " + f.attrs);
      for (const r of M.FILE_RULES) if (r.re.test(t)) return r.key;
      return "resumeFile?"; // decided later (only file input on the page → resume)
    }
    // 3) generic rules: label first, then machine attributes
    const ctxOk = (r) => r.ctx === "any" || r.ctx === f.section;
    const label = norm(f.label);
    const attrs = norm(f.attrs);
    for (const pass of ["label", "attr"]) {
      const text = pass === "label" ? label : attrs;
      if (!text) continue;
      for (const r of M.RULES) {
        const re = pass === "label" ? r.label : r.attr;
        if (!re || !ctxOk(r)) continue;
        if (!re.test(text)) continue;
        if (r.not && r.not.test(label)) continue;
        if (r.key.startsWith("__")) return r.key;
        if (!M.keyAllowsKind(r.key, f.kind)) continue;
        if (r.key.startsWith("eeo.") && !settings.fillEeo) return "__eeo";
        return r.key;
      }
    }
    return null;
  }

  function datePart(f) {
    if (f.el.type === "month" || f.el.type === "date") return "full";
    const ph = norm(f.el.getAttribute("placeholder") || "");
    if (/mm (dd )?yyyy|yyyy mm|mm yy\b/.test(ph)) return "full";
    const own = norm(directLabel(f.el) + " " + f.attrs);
    if (/\bmonth\b|\bmm\b/.test(own)) return "month";
    if (/\byear\b|\byyyy\b/.test(own)) return "year";
    if (f.kind === "select") {
      const opts = [...f.el.options].map(o => norm(o.text));
      if (opts.filter(o => M.MONTHS.some(m => o.startsWith(m.slice(0, 3)))).length >= 10) return "month";
      if (opts.filter(o => /^(19|20)\d{2}$/.test(o)).length >= 5) return "year";
    }
    const lab = norm(f.label);
    if (/\bmonth\b/.test(lab) && !/\byear\b/.test(lab)) return "month";
    if (/\byear\b/.test(lab) && !/\bmonth\b/.test(lab)) return "year";
    return "full";
  }

  function valueFor(key, f, ctx) {
    const p = ctx.profile;
    const jobs = (p.workHistory || []).filter(j => j && (j.company || j.title));
    const edus = (p.education || []).filter(e => e && (e.school || e.degree));
    const counter = (k) => {
      if (f.entryIndex != null && f.entryIndex >= 0) return f.entryIndex;
      const c = ctx.counters[k] || 0;
      ctx.counters[k] = c + 1;
      return c;
    };

    if (key.startsWith("job.") || key.startsWith("edu.")) {
      const [grp, sub] = key.split(".");
      const isDate = sub === "start" || sub === "end";
      const part = isDate ? datePart(f) : "";
      const i = counter(key + ":" + part);
      const entry = (grp === "job" ? jobs : edus)[i];
      if (!entry) return { value: "", beyond: true };
      if (sub === "current") return { value: !!entry.current };
      if (isDate) {
        if (sub === "end" && entry.current) return { value: "", beyond: true };
        const raw = entry[sub];
        if (!raw) return { value: "" };
        if (f.kind === "select" || f.kind === "listbox" || f.kind === "radio") {
          const d = M.splitDate(raw);
          return { value: part === "month" ? (d && d.m) : part === "year" ? (d && d.y) : M.formatDate(raw, "full", f.el), part };
        }
        return { value: M.formatDate(raw, part, f.el), part };
      }
      return { value: entry[sub] ?? "" };
    }

    if (key.startsWith("eeo.")) return { value: (p.eeo || {})[key.slice(4)] || "" };

    switch (key) {
      case "fullName": return { value: p.fullName || [p.firstName, p.middleName, p.lastName].filter(Boolean).join(" ") };
      case "location": {
        const code = (p.state || "").length === 2 ? p.state.toUpperCase() : M.STATE_BY_NAME[norm(p.state)];
        const full = code ? M.US_STATES[code] : p.state;
        const alt = [p.city && full && `${p.city}, ${full}`, p.city && code && `${p.city}, ${code}`].filter(Boolean);
        return { value: p.location || [p.city, p.state].filter(Boolean).join(", "), search: p.city || p.location, alt };
      }
      case "currentCompany": { const c = jobs.find(j => j.current) || jobs[0]; return { value: p.currentCompany || (c && c.company) || "" }; }
      case "currentTitle": { const c = jobs.find(j => j.current) || jobs[0]; return { value: p.currentTitle || (c && c.title) || "" }; }
      case "phoneCountryCode": return { value: p.phoneCountryCode || "+1", search: p.country || "United States" };
      case "phone": {
        let v = p.phone || "";
        const max = parseInt(f.el.getAttribute("maxlength") || "0", 10);
        if (max && max <= 11) v = v.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
        return { value: v };
      }
      case "startDate": return { value: f.el.type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(p.startDate || "") ? p.startDate : (p.startDate || "") };
      case "state": {
        const v = p.state || "";
        const code = v.length === 2 ? v.toUpperCase() : M.STATE_BY_NAME[norm(v)];
        const full = code ? M.US_STATES[code] : v;
        return { value: f.kind === "text" ? v : full, alt: [code, full].filter(Boolean), search: full };
      }
      case "country": return { value: p.country || "United States", search: p.country || "United States" };
      default: return { value: p[key] ?? "" };
    }
  }

  // ---------------------------------------------------------------------------
  // Setting values in a way frameworks notice
  // ---------------------------------------------------------------------------
  function fire(el, type, init = {}) {
    const Ctor = type.startsWith("key") ? KeyboardEvent : type === "input" ? InputEvent : (type.startsWith("pointer") ? PointerEvent : type.startsWith("mouse") || type === "click" ? MouseEvent : (type === "focus" || type === "blur" || type === "focusin" || type === "focusout") ? FocusEvent : Event);
    let ev;
    try { ev = new Ctor(type, { bubbles: type !== "focus" && type !== "blur", cancelable: true, composed: true, ...init }); }
    catch (_) { ev = new Event(type, { bubbles: true, cancelable: true }); }
    el.dispatchEvent(ev);
  }

  function nativeSet(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, value); else el.value = value;
  }

  function setText(el, value, { blur = true } = {}) {
    if (el.isContentEditable && el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") {
      el.focus(); el.textContent = value; fire(el, "input", { inputType: "insertText", data: value }); if (blur) fire(el, "blur");
      return true;
    }
    try { el.focus({ preventScroll: true }); } catch (_) {}
    fire(el, "focus"); fire(el, "focusin");
    nativeSet(el, "");
    fire(el, "input", { inputType: "deleteContentBackward" });
    nativeSet(el, value);
    fire(el, "keydown", { key: "a" });
    fire(el, "input", { inputType: "insertText", data: String(value) });
    fire(el, "keyup", { key: "a" });
    fire(el, "change");
    if (blur) { fire(el, "blur"); fire(el, "focusout"); try { el.blur(); } catch (_) {} }
    return String(el.value) === String(value) || el.value.replace(/\D/g, "") === String(value).replace(/\D/g, "");
  }

  function realClick(el) {
    try { el.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (_) {}
    const r = el.getBoundingClientRect();
    const xy = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    fire(el, "pointerover", xy); fire(el, "pointerdown", xy); fire(el, "mousedown", xy);
    fire(el, "pointerup", xy); fire(el, "mouseup", xy);
    el.click();
  }

  function selectOption(el, value, key, opt) {
    const texts = [...el.options].map(o => o.text);
    let i = M.bestOption(texts, value, key, opt);
    if (i < 0) i = M.bestOption([...el.options].map(o => o.value), value, key, opt);
    if (i < 0) return false;
    el.focus();
    el.selectedIndex = i;
    nativeSet(el, el.options[i].value);
    fire(el, "input"); fire(el, "change"); fire(el, "blur");
    return true;
  }

  function clickChoice(els, options, value, key, opt) {
    const i = M.bestOption(options, value, key, opt);
    if (i < 0) return false;
    const target = els[i];
    if (target.tagName === "INPUT" && target.checked) return true;
    if (target.tagName === "INPUT" && !visible(target)) {
      const lab = (target.labels && target.labels[0]) || target.closest("label");
      if (lab) lab.click(); else target.click();
    } else realClick(target);
    if (target.tagName === "INPUT" && !target.checked) target.click();
    return true;
  }

  const OPTION_SEL = '[role="option"], [data-automation-id="promptOption"], [id*="-option-"], .select__option, .select2-results__option, li[data-value]';

  function visibleOptions(scope) {
    const roots = scope ? [scope] : [document];
    let opts = [];
    for (const r of roots) opts = opts.concat(deepCollect(r.body || r, e => e.matches && e.matches(OPTION_SEL)));
    return opts.filter(o => visible(o) && o.textContent.trim() && !o.closest('[aria-hidden="true"]'));
  }

  function listboxFor(el) {
    const ids = el.getAttribute("aria-controls") || el.getAttribute("aria-owns");
    if (ids) { const lb = byIds(ids, el.getRootNode())[0]; if (lb) return lb; }
    return null;
  }

  async function waitForOptions(el, timeout = 2500) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const lb = listboxFor(el);
      let opts = lb ? visibleOptions(lb) : [];
      if (!opts.length) opts = visibleOptions();
      const real = opts.filter(o => !/^(loading|searching|no (options|results|matches)|type to search)/i.test(o.textContent.trim()));
      if (real.length) return real;
      await sleep(120);
    }
    return [];
  }

  function closeMenus(el) {
    fire(el, "keydown", { key: "Escape", code: "Escape", keyCode: 27 });
  }

  function optionText(o) {
    const lab = o.querySelector('[data-automation-id="promptLeafNode"], [data-automation-id="promptOption"]');
    return (lab ? lab.textContent : o.textContent).replace(/\s+/g, " ").trim();
  }

  async function chooseFromOpenList(el, value, key, opt) {
    const opts = await waitForOptions(el);
    if (!opts.length) return false;
    const i = M.bestOption(opts.map(optionText), value, key, opt);
    if (i < 0) return false;
    realClick(opts[i]);
    await sleep(250);
    return true;
  }

  async function setListbox(el, value, key, opt) {
    realClick(el);
    await sleep(200);
    let ok = await chooseFromOpenList(el, value, key, opt);
    if (!ok) {
      // Long virtualised lists: type to jump, then look again.
      for (const ch of String(opt.search || value).slice(0, 12)) fire(document.activeElement || el, "keydown", { key: ch });
      await sleep(400);
      ok = await chooseFromOpenList(el, value, key, opt);
    }
    if (!ok) closeMenus(el);
    return ok;
  }

  async function setCombobox(el, value, key, opt) {
    const term = String(opt.search || value);
    realClick(el);
    setText(el, term, { blur: false });
    if (el.getAttribute("data-automation-id") === "searchBox") fire(el, "keydown", { key: "Enter", code: "Enter", keyCode: 13 });
    await sleep(300);
    let ok = await chooseFromOpenList(el, value, key, opt);
    if (!ok && term !== String(value)) { setText(el, String(value), { blur: false }); await sleep(300); ok = await chooseFromOpenList(el, value, key, opt); }
    if (!ok) {
      // Free-text combos (e.g. Lever location) keep the typed text; others get cleared.
      if (!/^(location|city|edu\.school|edu\.major|job\.location)$/.test(key)) { closeMenus(el); }
      fire(el, "blur");
      return el.value && norm(el.value) === norm(term) ? "typed" : false;
    }
    fire(el, "blur");
    return true;
  }

  function dataUrlToFile(f) {
    const [meta, b64] = String(f.data).split(",");
    const mime = (meta.match(/data:([^;]+)/) || [])[1] || f.type || "application/pdf";
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], f.name || "resume.pdf", { type: mime, lastModified: Date.now() });
  }

  function setFile(el, stored) {
    const file = dataUrlToFile(stored);
    const dt = new DataTransfer();
    dt.items.add(file);
    el.files = dt.files;
    fire(el, "input"); fire(el, "change");
    return el.files && el.files.length === 1;
  }

  // ---------------------------------------------------------------------------
  // "Already has a value?" checks (so we don't clobber what you typed)
  // ---------------------------------------------------------------------------
  function hasValue(f) {
    const el = f.el;
    switch (f.kind) {
      case "text": case "textarea": return el.isContentEditable && el.tagName !== "INPUT" ? !!el.textContent.trim() : !!String(el.value || "").trim();
      case "select": { const o = el.options[el.selectedIndex]; return !!(o && o.value && !M.isPlaceholderOpt(o.text)); }
      case "radio": case "checkgroup": return f.els.some(e => e.checked);
      case "checkbox": return false;
      case "file": return !!(el.files && el.files.length);
      case "buttons": return f.els.some(b => b.getAttribute("aria-pressed") === "true" || b.getAttribute("aria-checked") === "true" || /selected|active|checked/i.test(b.className));
      case "listbox": { const t = norm(el.textContent || el.value); return !!t && !M.isPlaceholderOpt(t) && !/select one/.test(t); }
      case "combobox": {
        if (String(el.value || "").trim()) return true;
        const box = el.closest('[class*="container"], [data-automation-id="multiselectInputContainer"], [class*="select"]') || parentOf(el);
        return !!(box && [...box.querySelectorAll('[class*="single-value"], [class*="singleValue"], [data-automation-id="selectedItem"], [class*="multi-value"]')].some(x => visible(x) && x.textContent.trim()));
      }
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Highlighting + toast
  // ---------------------------------------------------------------------------
  function mark(f, cls, settings) {
    if (!settings.highlight) return;
    const targets = f.kind === "radio" || f.kind === "checkgroup" || f.kind === "buttons"
      ? [f.els[0].closest('fieldset, [role="radiogroup"], [role="group"]') || f.els[0].parentElement?.parentElement || f.els[0]]
      : f.kind === "file" ? [visible(f.el) ? f.el : (f.el.closest("label, [class*='upload'], [class*='drop'], [data-automation-id*='file']") || f.el.parentElement)]
      : [f.el];
    for (const t of targets) if (t && t.classList) { t.classList.remove("jaf-filled", "jaf-attention"); t.classList.add(cls); }
  }

  function toast(summary) {
    if (window.top !== window && summary.filled === 0 && summary.needsAttention === 0) return;
    const old = document.querySelector(".jaf-toast"); if (old) old.remove();
    const d = document.createElement("div");
    d.className = "jaf-toast";
    d.setAttribute("data-jaf-ignore", "");
    const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    d.innerHTML = `<b>Job Autofill</b>${summary.profileName ? ` (${esc(summary.profileName)})` : ""} · ${summary.filled} filled` + (summary.skipped ? ` · ${summary.skipped} already set` : "") +
      (summary.needsAttention ? ` · <span class="jaf-t-attn">${summary.needsAttention} need you</span>` : "") +
      `<div class="jaf-t-sub">Review everything, then submit yourself.</div>`;
    d.addEventListener("click", () => d.remove());
    document.documentElement.appendChild(d);
    setTimeout(() => d.remove(), 7000);
  }

  // ---------------------------------------------------------------------------
  // Main
  // ---------------------------------------------------------------------------
  let running = false;

  async function run(opts = {}) {
    if (running) return null;
    running = true;
    try {
      const { profileId, ...overrides } = opts || {};
      const store = await loadStore(profileId);
      const profile = store.profile || {};
      const settings = { ...DEFAULT_SETTINGS, ...(store.settings || {}), ...overrides };
      const adapter = AD.detect(location);
      const ctx = { profile, settings, counters: {}, adapter };

      if (adapter.prepare) { try { await adapter.prepare(ctx); } catch (e) { console.warn("[Job Autofill] prepare", e); } }

      const fields = collectFields();
      const fileFields = fields.filter(f => f.kind === "file");
      const summary = { site: adapter.name, profileName: store.profileName || null, filled: 0, skipped: 0, needsAttention: 0, details: [] };

      for (const f of fields) {
        let key = null, value = null, extra = {};
        const custom = f.kind === "file" ? null : customAnswerFor(f, profile);
        if (custom != null) { key = "custom"; value = custom; }
        else {
          key = keyFor(f, adapter, settings);
          if (key === "resumeFile?") key = fileFields.length === 1 ? "resumeFile" : null;
        }

        const record = (status) => summary.details.push({ kind: f.kind, label: f.label.slice(0, 80), section: f.section, key, value: typeof value === "string" ? value.slice(0, 40) : value, status });

        if (!key || key === "__skip" || key === "__consent" || key === "__eeo") {
          if (f.required && !hasValue(f)) { mark(f, "jaf-attention", settings); summary.needsAttention++; record("attention"); }
          else record("ignored");
          continue;
        }

        if (key === "resumeFile" || key === "coverLetterFile") {
          const stored = store[key];
          if (!stored || !stored.data) { if (f.required && !hasValue(f)) { mark(f, "jaf-attention", settings); summary.needsAttention++; } record("no-file"); continue; }
          if (hasValue(f) && !settings.overwrite) { summary.skipped++; record("kept"); continue; }
          try { if (setFile(f.el, stored)) { mark(f, "jaf-filled", settings); summary.filled++; record("filled"); continue; } } catch (e) { console.warn("[Job Autofill] file", e); }
          summary.needsAttention++; mark(f, "jaf-attention", settings); record("failed");
          continue;
        }

        if (value == null) {
          const r = valueFor(key, f, ctx);
          value = r.value; extra = r;
        }
        const empty = value === "" || value == null || (key === "job.current" && value === false);
        if (empty) {
          if (f.required && !hasValue(f) && !extra.beyond) { mark(f, "jaf-attention", settings); summary.needsAttention++; record("attention"); }
          else record("no-value");
          continue;
        }
        if (hasValue(f) && !settings.overwrite) { summary.skipped++; record("kept"); continue; }

        // A Yes/No question whose answer we only know as a fact (e.g. "Have you
        // completed a Bachelor's?" vs degree = "Bachelor of Science") — leave it to you.
        const choiceTexts = f.kind === "select" ? [...f.el.options].map(o => o.text) : f.options;
        if (choiceTexts && key !== "custom" && M.yesNoOf(value) == null && typeof value === "string") {
          const real = choiceTexts.filter(t => t && !M.isPlaceholderOpt(t));
          if (real.length && real.length <= 3 && real.every(t => /^(yes|no)\b/i.test(t.trim()))) {
            if (f.required && !hasValue(f)) { mark(f, "jaf-attention", settings); summary.needsAttention++; record("attention"); } else record("yes-no-unknown");
            continue;
          }
        }
        const opt = { country: profile.country, alt: extra.alt || [], part: extra.part, search: extra.search };
        let ok = false;
        try {
          switch (f.kind) {
            case "text": case "textarea": ok = setText(f.el, String(value)); break;
            case "select": ok = selectOption(f.el, String(value), key, opt); break;
            case "radio": case "checkgroup": case "buttons": ok = clickChoice(f.els, f.options, String(value), key, opt); break;
            case "checkbox": {
              const want = value === true || M.yesNoOf(value) === "yes";
              if (want && !f.el.checked) f.el.click();
              ok = want ? f.el.checked : false;
              break;
            }
            case "listbox": ok = await setListbox(f.el, String(value), key, opt); break;
            case "combobox": ok = await setCombobox(f.el, String(value), key, opt); break;
          }
        } catch (e) { console.warn("[Job Autofill] fill", key, e); ok = false; }

        if (ok) { mark(f, "jaf-filled", settings); summary.filled++; record(ok === "typed" ? "typed" : "filled"); }
        else { mark(f, "jaf-attention", settings); summary.needsAttention++; record("failed"); }
        await sleep(f.kind === "listbox" || f.kind === "combobox" ? 150 : 15);
      }

      if (fields.length) toast(summary);
      return summary;
    } finally {
      running = false;
    }
  }

  window.__jobAutofill = { run, _collect: collectFields, _keyFor: keyFor };

  // Listen for messages (popup → background → tab) too, for robustness.
  try {
    chrome.runtime.onMessage.addListener((msg, _s, send) => {
      if (msg && msg.type === "jaf-run") { run({ profileId: msg.profileId }).then(send); return true; }
    });
  } catch (_) {}
})();
