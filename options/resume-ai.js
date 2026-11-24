// Job Autofill — "Fill profile from resume": resume text → Claude Haiku → profile fields.
// The API key comes from a .env file in the extension folder (git-ignored).
import { resumeToText } from "../lib/resume-text.js";

const $ = (s, r = document) => r.querySelector(s);
const ST = window.JAF_STORE;
const O = () => window.JAF_OPTIONS;
const DEFAULT_MODEL = "claude-haiku-5-5";
const MAX_CHARS = 40000;

// ---------------------------------------------------------------------------
// Config from .env
// ---------------------------------------------------------------------------
async function loadEnv() {
  try {
    const res = await fetch(chrome.runtime.getURL(".env"), { cache: "no-store" });
    if (!res.ok) return {};
    const env = {};
    for (const raw of (await res.text()).split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      else v = v.replace(/\s+#.*$/, "");
      env[m[1]] = v;
    }
    return env;
  } catch (_) {
    return {}; // no .env file
  }
}

async function config() {
  const env = await loadEnv();
  return { apiKey: env.ANTHROPIC_API_KEY || "", model: env.ANTHROPIC_MODEL || DEFAULT_MODEL };
}

// ---------------------------------------------------------------------------
// Claude call
// ---------------------------------------------------------------------------
async function callClaude({ apiKey, model }, system, user, maxTokens = 4096) {
  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] })
    });
  } catch (e) {
    throw new Error("Couldn't reach Anthropic. Check your internet connection");
  }
  let body = null;
  try { body = await res.json(); } catch (_) {}
  if (!res.ok) {
    const msg = body && body.error && body.error.message;
    if (res.status === 401) throw new Error("Anthropic rejected the API key. Check ANTHROPIC_API_KEY in .env");
    if (res.status === 404 && /model/i.test(msg || "")) throw new Error(`Model "${model}" wasn't found. Set ANTHROPIC_MODEL in .env`);
    if (res.status === 429) throw new Error("Rate limited by Anthropic. Wait a minute and try again");
    if (res.status === 529 || res.status >= 500) throw new Error("Anthropic is busy right now. Try again in a moment");
    throw new Error(msg || `Anthropic returned an error (${res.status})`);
  }
  const text = (body.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  return { text, stopReason: body.stop_reason };
}

// ---------------------------------------------------------------------------
// Resume → profile JSON
// ---------------------------------------------------------------------------
const SYSTEM = `You extract structured data from resumes for a job-application autofill tool.
Return ONLY a JSON object, no prose and no code fences, with exactly these keys:
{
  "firstName": "", "middleName": "", "lastName": "",
  "email": "", "phone": "",
  "address1": "", "address2": "", "city": "", "state": "", "zip": "", "country": "",
  "linkedin": "", "github": "", "portfolio": "", "website": "",
  "yearsExperience": "",
  "skills": "",
  "summary": "", "summaryWrittenByAI": false,
  "workHistory": [ { "company": "", "title": "", "location": "", "start": "YYYY-MM", "end": "YYYY-MM", "current": false, "description": "" } ],
  "education": [ { "school": "", "degree": "", "major": "", "gpa": "", "start": "YYYY-MM", "end": "YYYY-MM" } ]
}
Rules:
- Use only facts in the resume. Never invent employers, dates, degrees, GPAs, links or contact details. Use "" (or [] / false) when something isn't there.
- Dates are "YYYY-MM". If only a year is given use "YYYY-01". For a current job set "current": true and "end": "".
- workHistory and education are most recent first.
- "description": the job's bullet points as plain lines starting with "- ", keeping the resume's wording.
- "state": a US state as its 2-letter code (e.g. "TX"); otherwise as written. "country": "United States" for US addresses.
- Links: full URLs starting with https:// (add it if the resume omits it).
- "degree": the full degree name, e.g. "Bachelor of Science". "major": the field, e.g. "Computer Science".
- "yearsExperience": total years of professional work as a whole number string, counted from the work history dates.
- "skills": comma-separated list of the skills the resume lists.
- "summary": the resume's summary/objective if it has one. If it has none, write 2-3 factual sentences from the resume in first person, and set "summaryWrittenByAI": true.`;

function parseJson(text) {
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s < 0 || e <= s) throw new Error("The AI's answer wasn't readable. Try again");
  try { return JSON.parse(text.slice(s, e + 1)); }
  catch (_) { throw new Error("The AI's answer wasn't readable. Try again"); }
}

const str = (v) => (v == null ? "" : String(v)).trim();

function normDate(v) {
  const s = str(v);
  if (!s || /present|current|now/i.test(s)) return "";
  let m = s.match(/^(\d{4})-(\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})\/(\d{4})$/); if (m) return `${m[2]}-${m[1].padStart(2, "0")}`;
  m = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+((?:19|20)\d{2})\b/i);
  if (m) return `${m[2]}-${String(["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].indexOf(m[1].toLowerCase()) + 1).padStart(2, "0")}`;
  m = s.match(/\b(19|20)\d{2}\b/); if (m) return `${m[0]}-01`;
  return "";
}

function normUrl(v) {
  const s = str(v);
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(s)) return "https://" + s;
  return s;
}

function normalize(raw) {
  const r = raw || {};
  const out = {};
  for (const k of ["firstName", "middleName", "lastName", "email", "phone", "address1", "address2", "city", "state", "zip", "country", "skills", "summary"]) out[k] = str(r[k]);
  for (const k of ["linkedin", "github", "portfolio", "website"]) out[k] = normUrl(r[k]);
  out.yearsExperience = str(r.yearsExperience).replace(/[^\d.]/g, "");
  out.summaryWrittenByAI = !!r.summaryWrittenByAI;
  out.workHistory = (Array.isArray(r.workHistory) ? r.workHistory : []).map(j => {
    const current = !!j.current || /present|current/i.test(str(j.end));
    return { company: str(j.company), title: str(j.title), location: str(j.location), start: normDate(j.start), end: current ? "" : normDate(j.end), current, description: str(j.description) };
  }).filter(j => j.company || j.title);
  out.education = (Array.isArray(r.education) ? r.education : []).map(e => ({
    school: str(e.school), degree: str(e.degree), major: str(e.major), gpa: str(e.gpa), start: normDate(e.start), end: normDate(e.end)
  })).filter(e => e.school || e.degree);
  return out;
}

async function readResume(file) {
  const cfg = await config();
  if (!cfg.apiKey) { const e = new Error("Add your Anthropic API key first (see AI resume reader below)"); e.noKey = true; throw e; }
  let text = await resumeToText(file);
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS);
  const { text: answer, stopReason } = await callClaude(cfg, SYSTEM, `Resume text:\n<<<\n${text}\n>>>`);
  if (stopReason === "max_tokens" && answer.lastIndexOf("}") < answer.length - 5) throw new Error("The resume was too long to read in one go");
  return normalize(parseJson(answer));
}

// ---------------------------------------------------------------------------
// Review dialog + apply
// ---------------------------------------------------------------------------
const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ym = (d) => { if (!d) return ""; const [y, m] = d.split("-"); return new Date(+y, +m - 1, 1).toLocaleString("en-US", { month: "short", year: "numeric" }); };

function sectionsFor(found) {
  const contactKeys = [["firstName", "First name"], ["middleName", "Middle name"], ["lastName", "Last name"], ["email", "Email"], ["phone", "Phone"],
    ["address1", "Street"], ["address2", "Apt / suite"], ["city", "City"], ["state", "State"], ["zip", "ZIP"], ["country", "Country"]];
  const linkKeys = [["linkedin", "LinkedIn"], ["github", "GitHub"], ["portfolio", "Portfolio"], ["website", "Website"]];
  const kv = (pairs) => pairs.filter(([k]) => found[k]).map(([k, l]) => `<li><span class="muted">${l}:</span> ${esc(found[k])}</li>`);
  const secs = [];
  const contact = kv(contactKeys);
  if (contact.length) secs.push({ id: "contact", title: "Name & contact", hint: "only fields found in the resume are changed", items: contact });
  const links = kv(linkKeys);
  if (links.length) secs.push({ id: "links", title: "Links", items: links });
  if (found.workHistory.length) secs.push({ id: "work", title: `Work history (${found.workHistory.length})`, hint: "replaces your current list",
    items: found.workHistory.map(j => `<li>${esc(j.title || "—")} · ${esc(j.company || "—")} <span class="muted">${ym(j.start)}–${j.current ? "Present" : ym(j.end)}</span></li>`) });
  if (found.education.length) secs.push({ id: "edu", title: `Education (${found.education.length})`, hint: "replaces your current list (keeps your GPA if the resume has none)",
    items: found.education.map(e => `<li>${esc([e.degree, e.major].filter(Boolean).join(", ") || "—")} · ${esc(e.school || "—")}${e.gpa ? ` <span class="muted">GPA ${esc(e.gpa)}</span>` : ""}</li>`) });
  const extra = [];
  if (found.yearsExperience) extra.push(`<li><span class="muted">Years of experience:</span> ${esc(found.yearsExperience)}</li>`);
  if (found.skills) extra.push(`<li><span class="muted">Skills:</span> ${esc(found.skills.slice(0, 220))}${found.skills.length > 220 ? "…" : ""}</li>`);
  if (found.summary) extra.push(`<li><span class="muted">Summary${found.summaryWrittenByAI ? " (written by AI; your resume has none)" : ""}:</span> ${esc(found.summary)}</li>`);
  if (extra.length) secs.push({ id: "extra", title: "Summary, skills & experience", items: extra });
  return secs;
}

function review(found, profileName) {
  const dlg = $("#ai-dlg");
  $("#ai-dlg-profile").textContent = profileName;
  const box = $("#ai-sections");
  const secs = sectionsFor(found);
  box.innerHTML = secs.length ? secs.map(s => `
    <div class="ai-sec">
      <label class="check"><input type="checkbox" data-sec="${s.id}" checked> ${s.title}${s.hint ? ` <span class="muted small">(${s.hint})</span>` : ""}</label>
      <ul>${s.items.join("")}</ul>
    </div>`).join("") : `<p>Nothing usable was found in that resume.</p>`;
  return new Promise((resolve) => {
    dlg.onclose = () => resolve(dlg.returnValue === "ok" ? new Set([...box.querySelectorAll("[data-sec]:checked")].map(c => c.dataset.sec)) : null);
    dlg.returnValue = "";
    dlg.showModal();
  });
}

function apply(profile, found, picked) {
  if (picked.has("contact")) for (const k of ["firstName", "middleName", "lastName", "email", "phone", "address1", "address2", "city", "state", "zip", "country"]) if (found[k]) profile[k] = found[k];
  if (picked.has("links")) for (const k of ["linkedin", "github", "portfolio", "website"]) if (found[k]) profile[k] = found[k];
  if (picked.has("work")) profile.workHistory = found.workHistory;
  if (picked.has("edu")) {
    const old = profile.education || [];
    const sameSchool = (a, b) => a && b && a.toLowerCase().replace(/\W/g, "") === b.toLowerCase().replace(/\W/g, "");
    profile.education = found.education.map((e, i) => {
      if (e.gpa) return e;
      const match = old.find(o => sameSchool(o.school, e.school)) || (old.length === 1 && found.education.length === 1 ? old[0] : null) || (!old[i]?.school ? old[i] : null);
      return match && match.gpa ? { ...e, gpa: match.gpa } : e;
    });
  }
  if (picked.has("extra")) {
    if (found.yearsExperience) profile.yearsExperience = found.yearsExperience;
    if (found.skills) profile.skills = found.skills;
    if (found.summary) profile.summary = found.summary;
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
const btn = $("#ai-fill");
const status = $("#ai-status");
function setStatus(text, cls = "") { status.textContent = text; status.className = "ai-status " + cls; }

async function currentResume() {
  const id = O().getProfileId();
  if (!id) return null;
  const key = ST.fileKey(id, "resume");
  return (await chrome.storage.local.get(key))[key] || null;
}

async function refreshButton() {
  const file = await currentResume();
  btn.disabled = !file;
  btn.title = file ? "" : "Upload a resume first";
}

async function refreshKeyStatus() {
  const cfg = await config();
  $("#ai-model").textContent = cfg.model;
  const s = $("#ai-key-status");
  if (cfg.apiKey) { s.textContent = `found in .env (…${cfg.apiKey.slice(-4)})`; s.className = "ok"; }
  else { s.textContent = "not set. Add a .env file (see below)"; s.className = "err"; }
}

btn.addEventListener("click", async () => {
  const file = await currentResume();
  if (!file) return;
  btn.disabled = true;
  setStatus("Reading your resume…");
  try {
    const found = await readResume(file);
    setStatus("");
    const picked = await review(found, await O().getProfileName());
    if (picked && picked.size) {
      apply(O().getProfile(), found, picked);
      await O().applied();
      setStatus("Profile updated. Check the dates and details below.", "ok");
    }
  } catch (e) {
    setStatus(e.message + ".", "err");
    if (e.noKey) { $("#ai").scrollIntoView({ behavior: "smooth" }); $("#ai details").open = true; }
  } finally {
    btn.disabled = false;
  }
});

$("#ai-test").addEventListener("click", async () => {
  const out = $("#ai-test-result");
  out.textContent = "Testing…"; out.className = "ai-status";
  try {
    const cfg = await config();
    if (!cfg.apiKey) throw new Error("No ANTHROPIC_API_KEY in .env");
    const { text } = await callClaude(cfg, "Reply with exactly: OK", "ping", 10);
    out.textContent = `Connected to ${cfg.model} (${text.trim() || "OK"})`; out.className = "ai-status ok";
  } catch (e) { out.textContent = e.message; out.className = "ai-status err"; }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.activeProfileId || Object.keys(changes).some(k => k.startsWith("file:"))) { refreshButton(); setStatus(""); }
});

document.addEventListener("jaf-profile-switched", () => { refreshButton(); setStatus(""); });
refreshButton();
refreshKeyStatus();

// Exposed for tests
window.JAF_AI = { normalize, apply, resumeToText };
