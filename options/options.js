// Job Autofill — options page: manage profiles, edit the selected one, global settings.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clone = (o) => JSON.parse(JSON.stringify(o));
const ST = window.JAF_STORE;

let currentId = null;   // profile being edited
let profile = null;     // its data
let settings = null;    // global settings
let saveTimer = null;

const getPath = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
function setPath(obj, path, val) {
  const ks = path.split(".");
  let o = obj;
  for (const k of ks.slice(0, -1)) o = o[k] = o[k] || {};
  o[ks.at(-1)] = val;
}

function flashSaved(text = "Saved") {
  const s = $("#saved");
  s.textContent = text;
  s.classList.add("show");
  clearTimeout(flashSaved.t);
  flashSaved.t = setTimeout(() => s.classList.remove("show"), 1400);
}

async function saveNow() {
  clearTimeout(saveTimer); saveTimer = null;
  if (currentId && profile) await ST.saveData(currentId, profile);
  await chrome.storage.local.set({ settings });
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => { await saveNow(); flashSaved(); }, 250);
}

// ---------- profile bar ----------
const nameOf = async (id) => (await ST.ensure()).profiles[id]?.name || "";

async function renderProfileBar() {
  const { items } = await ST.list();
  const sel = $("#profile-select");
  sel.innerHTML = "";
  for (const p of items) {
    const o = document.createElement("option");
    o.value = p.id; o.textContent = p.name;
    sel.appendChild(o);
  }
  sel.value = currentId;
  $("#p-delete").disabled = items.length <= 1;
  $("#p-delete").title = items.length <= 1 ? "You need at least one profile" : "";
  $("#pb-note").hidden = items.length > 1;
}

async function switchTo(id) {
  if (saveTimer) await saveNow();
  const { profiles } = await ST.ensure();
  currentId = id;
  profile = profiles[id].data || {};
  profile.eeo = profile.eeo || {};
  await ST.setActive(id); // the profile you last looked at is the one the shortcut uses
  fillForm();
  await renderProfileBar();
  await refreshFiles();
  $("#new-banner").hidden = true;
}

$("#profile-select").addEventListener("change", (e) => switchTo(e.target.value));

// One small dialog for New / Rename / Delete.
function openDialog({ title, okText, name = "", showNew = false, showName = true, message = "", danger = false }) {
  const dlg = $("#dlg");
  $("#dlg-title").textContent = title;
  $("#dlg-ok").textContent = okText;
  $("#dlg-ok").classList.toggle("danger-fill", danger);
  $("#dlg-name").value = name;
  $("#dlg-name").parentElement.hidden = !showName;
  $("#dlg-name").required = showName;
  $("#dlg-new-opts").hidden = !showNew;
  $("#dlg-msg").textContent = message;
  $("#dlg-msg").hidden = !message;
  return new Promise((resolve) => {
    dlg.onclose = () => resolve(dlg.returnValue === "ok" ? {
      name: $("#dlg-name").value.trim(),
      start: (document.querySelector('input[name="start"]:checked') || {}).value,
      src: $("#dlg-src").value,
      files: $("#dlg-files").checked
    } : null);
    dlg.returnValue = "";
    dlg.showModal();
    if (showName) { $("#dlg-name").focus(); $("#dlg-name").select(); }
  });
}
$("#dlg-src").addEventListener("change", () => { document.querySelector('input[name="start"][value="copy"]').checked = true; });

$("#p-new").addEventListener("click", async () => {
  if (saveTimer) await saveNow();
  const { items } = await ST.list();
  const src = $("#dlg-src");
  src.innerHTML = "";
  for (const p of items) { const o = document.createElement("option"); o.value = p.id; o.textContent = p.name; src.appendChild(o); }
  src.value = items[0].id; // the first profile, by default
  document.querySelector('input[name="start"][value="copy"]').checked = true;
  $("#dlg-files").checked = false;
  const r = await openDialog({ title: "New profile", okText: "Create", showNew: true });
  if (!r || !r.name) return;

  let id;
  if (r.start === "blank") {
    const blank = clone(window.JAF_DEFAULT_PROFILE);
    for (const k of Object.keys(blank)) if (typeof blank[k] === "string") blank[k] = "";
    blank.phoneCountryCode = "+1"; blank.phoneType = "Mobile"; blank.country = "United States";
    blank.workHistory = []; blank.education = []; blank.customAnswers = []; blank.eeo = {};
    id = await ST.create(r.name, blank);
  } else {
    id = await ST.duplicate(r.src, r.name, { files: r.files });
  }
  await switchTo(id);

  // Point at the resume so it's easy to swap.
  const banner = $("#new-banner");
  const srcName = r.start === "blank" ? "" : await nameOf(r.src);
  banner.innerHTML = "";
  banner.append(r.start === "blank"
    ? `Created "${r.name}". Fill it in below, then `
    : `Created "${r.name}" with everything from "${srcName}"${r.files ? ", including its files" : ""}. Next: `);
  const a = document.createElement("a");
  a.href = "#docs"; a.textContent = r.files ? "swap in a different resume" : "upload this profile's resume";
  banner.append(a, ".");
  banner.hidden = false;
  const docs = $("#docs");
  docs.classList.add("highlight");
  setTimeout(() => docs.classList.remove("highlight"), 4000);
  flashSaved("Profile created");
});

$("#p-rename").addEventListener("click", async () => {
  const r = await openDialog({ title: "Rename profile", okText: "Save", name: await nameOf(currentId) });
  if (!r || !r.name) return;
  await ST.rename(currentId, r.name);
  await renderProfileBar();
  flashSaved("Renamed");
});

$("#p-delete").addEventListener("click", async () => {
  const { items } = await ST.list();
  if (items.length <= 1) return;
  const name = await nameOf(currentId);
  const r = await openDialog({ title: "Delete profile?", okText: "Delete", showName: false, danger: true,
    message: `"${name}" and its resume will be removed. This can't be undone.` });
  if (!r) return;
  clearTimeout(saveTimer); saveTimer = null;
  await ST.remove(currentId);
  const { items: left } = await ST.list();
  await switchTo(left[0].id);
  flashSaved("Deleted");
});

// ---------- simple fields ----------
function bindSimple() {
  for (const el of $$("[data-key]")) {
    const update = () => { setPath(profile, el.dataset.key, el.value); save(); };
    el.addEventListener("input", update);
    el.addEventListener("change", update);
  }
  for (const el of $$("[data-setting]")) {
    el.checked = !!settings[el.dataset.setting];
    el.addEventListener("change", () => { settings[el.dataset.setting] = el.checked; save(); });
  }
}

function fillForm() {
  for (const el of $$("[data-key]")) {
    const v = getPath(profile, el.dataset.key);
    el.value = v ?? "";
    if (el.tagName === "SELECT" && el.value !== (v ?? "") && el.options.length) el.selectedIndex = 0;
  }
  Object.keys(LISTS).forEach(renderList);
}

// ---------- repeating lists ----------
const LISTS = {
  workHistory: { container: "#work-list", blank: { company: "", title: "", location: "", start: "", end: "", current: false, description: "" }, title: (x) => [x.title, x.company].filter(Boolean).join(" · ") || "New job" },
  education: { container: "#edu-list", blank: { school: "", degree: "", major: "", gpa: "", start: "", end: "" }, title: (x) => [x.degree, x.school].filter(Boolean).join(" · ") || "New school" },
  customAnswers: { container: "#custom-list", blank: { match: "", answer: "" } }
};

function renderList(name) {
  const cfg = LISTS[name];
  const box = $(cfg.container);
  box.innerHTML = "";
  const arr = profile[name] = profile[name] || [];
  arr.forEach((item, i) => {
    const node = $(`#tpl-${name}`).content.firstElementChild.cloneNode(true);
    const titleEl = $(".item-title", node);
    const refreshTitle = () => { if (titleEl && cfg.title) titleEl.textContent = cfg.title(item); };
    refreshTitle();
    for (const f of $$("[data-f]", node)) {
      const k = f.dataset.f;
      if (f.type === "checkbox") f.checked = !!item[k]; else f.value = item[k] ?? "";
      const update = () => {
        item[k] = f.type === "checkbox" ? f.checked : f.value;
        if (k === "current") { const end = $('[data-f="end"]', node); if (end) end.disabled = f.checked; }
        refreshTitle(); save();
      };
      f.addEventListener("input", update);
      f.addEventListener("change", update);
    }
    const end = $('[data-f="end"]', node); if (end && item.current) end.disabled = true;
    $("[data-remove]", node)?.addEventListener("click", () => { arr.splice(i, 1); renderList(name); save(); });
    $("[data-up]", node)?.addEventListener("click", () => { if (i > 0) { [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; renderList(name); save(); } });
    box.appendChild(node);
  });
}

for (const btn of $$("[data-add]")) {
  btn.addEventListener("click", () => {
    const name = btn.dataset.add;
    profile[name] = profile[name] || [];
    profile[name].push(clone(LISTS[name].blank));
    renderList(name); save();
  });
}

// ---------- files (per profile) ----------
const FILES = [
  { kind: "resume", input: "#resume-input", name: "#resume-name", clear: "#resume-clear" },
  { kind: "cover", input: "#cover-input", name: "#cover-name", clear: "#cover-clear" }
];

function readAsDataURL(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}

function showFile(cfg, f) {
  $(cfg.name).textContent = f ? `${f.name} (${Math.round((f.size || 0) / 1024)} KB)` : "None uploaded";
  $(cfg.clear).hidden = !f;
}

async function refreshFiles() {
  for (const cfg of FILES) {
    const key = ST.fileKey(currentId, cfg.kind);
    showFile(cfg, (await chrome.storage.local.get(key))[key]);
  }
}

for (const cfg of FILES) {
  $(cfg.input).addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { alert("That file is over 10 MB. Most job sites won't accept it."); return; }
    const stored = { name: file.name, type: file.type, size: file.size, data: await readAsDataURL(file) };
    await chrome.storage.local.set({ [ST.fileKey(currentId, cfg.kind)]: stored });
    showFile(cfg, stored); e.target.value = ""; flashSaved("File saved");
  });
  $(cfg.clear).addEventListener("click", async () => {
    await chrome.storage.local.remove(ST.fileKey(currentId, cfg.kind));
    showFile(cfg, null); flashSaved("Removed");
  });
}

// ---------- import / export / reset ----------
$("#export").addEventListener("click", async () => {
  await saveNow();
  const all = await chrome.storage.local.get(null);
  const blob = new Blob([JSON.stringify({ app: "job-autofill", version: 2, ...all }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "job-autofill-profiles.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});

$("#import").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.profiles) {
      // v2 export: add its profiles alongside the ones already here.
      const { profiles: mine, profileOrder } = await ST.ensure();
      const toSet = {};
      for (const oldId of data.profileOrder || Object.keys(data.profiles)) {
        const p = data.profiles[oldId]; if (!p) continue;
        const id = ST.newId();
        mine[id] = { name: p.name, data: p.data };
        profileOrder.push(id);
        for (const kind of ["resume", "cover"]) {
          const f = data[ST.fileKey(oldId, kind)];
          if (f) toSet[ST.fileKey(id, kind)] = f;
        }
      }
      await chrome.storage.local.set({ ...toSet, profiles: mine, profileOrder });
    } else if (data.profile) {
      // v1 export (single profile)
      const id = await ST.create(file.name.replace(/\.json$/i, "") || "Imported profile", data.profile);
      const toSet = {};
      if (data.resumeFile) toSet[ST.fileKey(id, "resume")] = data.resumeFile;
      if (data.coverLetterFile) toSet[ST.fileKey(id, "cover")] = data.coverLetterFile;
      await chrome.storage.local.set(toSet);
    } else throw new Error("No profiles found in that file");
    location.reload();
  } catch (err) { alert("Couldn't import: " + err.message); }
});

$("#reset").addEventListener("click", async () => {
  if (!confirm("Clear ALL profiles, files and answers? This can't be undone (export first if you want a backup).")) return;
  clearTimeout(saveTimer); saveTimer = null;
  await chrome.storage.local.clear();
  location.reload();
});

$("#shortcuts").addEventListener("click", () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" }));

// ---------- init ----------
(async function init() {
  let { profileOrder, activeProfileId, settings: s } = await ST.ensure();
  settings = { ...window.JAF_DEFAULT_SETTINGS, ...(s || {}) };
  if (!profileOrder.length) {
    // First run: one profile. More can be added with "New profile".
    activeProfileId = await ST.create("My profile", clone(window.JAF_DEFAULT_PROFILE));
    await ST.setActive(activeProfileId);
    await chrome.storage.local.set({ settings });
  }
  bindSimple();
  await switchTo(activeProfileId);
})();
