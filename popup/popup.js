const $ = (id) => document.getElementById(id);

async function refreshWarning() {
  const { profile } = await JAF_STORE.loadForFill($("profile-select").value);
  $("profile-warning").hidden = !!(profile && (profile.firstName || profile.email));
}

async function init() {
  const { settings = {} } = await chrome.storage.local.get("settings");
  $("overwrite").checked = !!settings.overwrite;

  const { items, active } = await JAF_STORE.list();
  const sel = $("profile-select");
  if (!items.length) {
    sel.innerHTML = "<option value=''>No profiles yet</option>";
    sel.disabled = true;
    $("profile-warning").hidden = false;
  } else {
    sel.innerHTML = items.map(p => `<option value="${p.id}"></option>`).join("");
    items.forEach((p, i) => { sel.options[i].textContent = p.name; });
    sel.value = active;
    $("pick-wrap").hidden = items.length < 2;
    refreshWarning();
  }
  sel.addEventListener("change", async () => { await JAF_STORE.setActive(sel.value); refreshWarning(); });

  try {
    const cmds = await chrome.commands.getAll();
    const c = cmds.find(x => x.name === "fill-form");
    if (c?.shortcut) $("shortcut").textContent = c.shortcut;
    else $("shortcut").textContent = "not set (chrome://extensions/shortcuts)";
  } catch (_) {}
}

$("overwrite").addEventListener("change", async (e) => {
  const { settings = {} } = await chrome.storage.local.get("settings");
  settings.overwrite = e.target.checked;
  await chrome.storage.local.set({ settings });
});

$("fill").addEventListener("click", async () => {
  const btn = $("fill");
  btn.disabled = true;
  btn.textContent = "Filling…";
  const res = await chrome.runtime.sendMessage({ type: "fill-active-tab", profileId: $("profile-select").value || null });
  btn.disabled = false;
  btn.textContent = "Fill this application";
  const box = $("result");
  box.hidden = false;
  box.className = "";
  if (!res || res.error) {
    box.className = "error";
    box.textContent = res?.error?.includes("Cannot access")
      ? "Chrome doesn't allow extensions on this page."
      : "Couldn't fill this page: " + (res?.error || "no response");
    return;
  }
  const site = res.site && res.site !== "generic" ? ` on ${res.site}` : "";
  box.innerHTML = `<strong>${res.filled} field${res.filled === 1 ? "" : "s"} filled</strong>${site}` +
    (res.needsAttention ? `<br><span class="attn">${res.needsAttention} need your answer (outlined orange)</span>` : "");
});

const openOptions = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); };
$("options-link").addEventListener("click", openOptions);
$("setup-link").addEventListener("click", openOptions);

init();
