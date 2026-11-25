// Job Autofill — background service worker.
// Relays "fill" requests (shortcut, right-click menu, popup) to every frame of the
// active tab, since many ATS forms (iCIMS, Taleo, embedded Greenhouse) live in iframes.
importScripts("lib/store.js");

const CONTENT_FILES = ["lib/store.js", "content/matchers.js", "content/adapters.js", "content/filler.js"];

async function fillTab(tabId, profileId = null) {
  const results = [];
  // Long fills (many skills) can outlast the worker's idle limit; a light call keeps it awake.
  const keepAwake = setInterval(() => { try { chrome.runtime.getPlatformInfo(() => void chrome.runtime.lastError); } catch (_) {} }, 20000);
  try {
    // Inject on demand into frames that loaded before the extension was installed.
    const injected = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      // Also true-up tabs still running an older copy (extension reloaded, page not refreshed).
      func: (ver) => !!(window.__jobAutofill && window.__jobAutofill.version === ver),
      args: [chrome.runtime.getManifest().version]
    });
    if (injected.some(r => !r.result)) {
      await chrome.scripting.insertCSS({ target: { tabId, allFrames: true }, files: ["content/filler.css"] });
      await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: CONTENT_FILES });
    }
    const runs = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: (pid) => window.__jobAutofill ? window.__jobAutofill.run({ profileId: pid }) : null,
      args: [profileId]
    });
    for (const r of runs) if (r.result) results.push(r.result);
  } catch (err) {
    return { error: String((err && err.message) || err) };
  } finally {
    clearInterval(keepAwake);
  }

  const total = { filled: 0, skipped: 0, needsAttention: 0, frames: results.length, site: null, profileName: null, notFound: [], report: [] };
  for (const r of results) {
    total.filled += r.filled || 0;
    total.skipped += r.skipped || 0;
    total.needsAttention += r.needsAttention || 0;
    total.notFound.push(...(r.notFound || []));
    // Diagnostics for the popup's "Copy report": field labels and outcomes only, never your values.
    total.report.push(...(r.report || []));
    if (r.site && r.site !== "generic") total.site = r.site;
    total.profileName = total.profileName || r.profileName;
  }
  total.site = total.site || "generic";
  // Keep the last report so it can be copied later (the popup closes while a long fill runs).
  if (results.length) try {
    const text = `Job Autofill report · ${total.site} · v${chrome.runtime.getManifest().version} · ${new Date().toLocaleString()}\nstatus\tkind\tkey\tlabel\tnote\n` + total.report.join("\n");
    await chrome.storage.local.set({ lastReport: text });
  } catch (_) {}
  return total;
}

// Right-click menu: one entry per profile ("Fill as: Tech jobs").
// Rebuilds run one at a time. Several triggers can arrive together (install,
// startup, storage changes), and overlapping rebuilds create duplicate menu ids.
const createMenu = (props) => new Promise((res) => chrome.contextMenus.create(props, () => { void chrome.runtime.lastError; res(); }));
const clearMenu = () => new Promise((res) => chrome.contextMenus.removeAll(() => { void chrome.runtime.lastError; res(); }));

let menuQueue = Promise.resolve();
function rebuildMenu() {
  menuQueue = menuQueue.then(buildMenu).catch((e) => console.warn("[Job Autofill] context menu:", e));
  return menuQueue;
}

async function buildMenu() {
  const { items } = await JAF_STORE.list();
  await clearMenu();
  const contexts = ["page", "editable", "frame"];
  if (items.length <= 1) {
    await createMenu({ id: "jaf-fill", title: "Fill job application", contexts });
    return;
  }
  await createMenu({ id: "jaf-root", title: "Fill job application", contexts });
  for (const p of items) {
    await createMenu({ id: "jaf-fill:" + p.id, parentId: "jaf-root", title: p.name, contexts });
  }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  try { await JAF_STORE.ensure(); } catch (e) { console.warn("[Job Autofill] setup:", e); }
  await rebuildMenu();
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(rebuildMenu);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.profileOrder || (changes.profiles && namesChanged(changes.profiles))) rebuildMenu();
});
function namesChanged(c) {
  const a = c.oldValue || {}, b = c.newValue || {};
  const ids = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const id of ids) if ((a[id] && a[id].name) !== (b[id] && b[id].name)) return true;
  return false;
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || !tab.id) return;
  const id = String(info.menuItemId);
  if (id === "jaf-fill") fillTab(tab.id);
  else if (id.startsWith("jaf-fill:")) fillTab(tab.id, id.slice(9));
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "fill-form") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id) fillTab(tab.id);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "fill-active-tab") {
    const find = msg.tabId ? chrome.tabs.get(msg.tabId).then(t => [t]) : chrome.tabs.query({ active: true, currentWindow: true });
    find.then(async ([tab]) => {
      if (!tab || !tab.id) return sendResponse({ error: "No active tab" });
      sendResponse(await fillTab(tab.id, msg.profileId || null));
    });
    return true; // async
  }
});
