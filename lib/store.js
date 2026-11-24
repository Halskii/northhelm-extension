// Job Autofill — shared storage helpers (options page, popup, background, content).
//
// chrome.storage.local layout:
//   profiles:        { [id]: { name, data } }   data = the profile fields
//   profileOrder:    [id, …]
//   activeProfileId: id used by the shortcut / default fill
//   settings:        global settings
//   file:<id>:resume, file:<id>:cover   { name, type, size, data(dataURL) }
//
// Older single-profile installs (profile / resumeFile / coverLetterFile) are
// migrated into one profile called "Main profile" the first time this runs.
(() => {
  const g = typeof self !== "undefined" ? self : window;
  if (g.JAF_STORE) return;

  const S = () => chrome.storage.local;
  const newId = () => "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const fileKey = (id, kind) => `file:${id}:${kind}`;

  // write=false (used by content scripts, which run in many frames at once)
  // never changes storage; a not-yet-migrated install is read in memory instead.
  async function ensure(write = true) {
    const st = await S().get(["profiles", "profileOrder", "activeProfileId", "profile", "resumeFile", "coverLetterFile", "settings"]);
    let profiles = st.profiles && typeof st.profiles === "object" ? st.profiles : {};
    let profileOrder = Array.isArray(st.profileOrder) ? st.profileOrder : [];
    let activeProfileId = st.activeProfileId;
    let changed = !st.profiles;

    if (st.profile) {
      // Old single-profile install → move it into "Main profile".
      const id = write ? newId() : "legacy";
      profiles = { ...profiles, [id]: { name: "Main profile", data: st.profile } };
      profileOrder = [...profileOrder, id];
      activeProfileId = id;
      changed = true;
      if (write) {
        const move = {};
        if (st.resumeFile) move[fileKey(id, "resume")] = st.resumeFile;
        if (st.coverLetterFile) move[fileKey(id, "cover")] = st.coverLetterFile;
        if (Object.keys(move).length) await S().set(move);
        await S().remove(["profile", "resumeFile", "coverLetterFile"]);
      } else {
        legacyFiles = { [fileKey(id, "resume")]: st.resumeFile, [fileKey(id, "cover")]: st.coverLetterFile };
      }
    }
    const ordered = profileOrder.filter(id => profiles[id]);
    for (const id of Object.keys(profiles)) if (!ordered.includes(id)) ordered.push(id);
    if (ordered.length !== profileOrder.length) changed = true;
    profileOrder = ordered;
    if (!profiles[activeProfileId]) { activeProfileId = profileOrder[0] || null; changed = true; }

    if (changed && write) await S().set({ profiles, profileOrder, activeProfileId });
    return { profiles, profileOrder, activeProfileId, settings: st.settings || {} };
  }
  let legacyFiles = null;

  async function list() {
    const { profiles, profileOrder, activeProfileId } = await ensure();
    return { active: activeProfileId, items: profileOrder.map(id => ({ id, name: profiles[id].name })) };
  }

  // Everything the fill engine needs for one profile (defaults to the active one).
  async function loadForFill(profileId) {
    const { profiles, activeProfileId, settings } = await ensure(false);
    const id = profiles[profileId] ? profileId : activeProfileId;
    if (!id) return { profile: {}, settings, profileName: null };
    const files = id === "legacy" && legacyFiles ? legacyFiles : await S().get([fileKey(id, "resume"), fileKey(id, "cover")]);
    return {
      profileId: id,
      profileName: profiles[id].name,
      profile: profiles[id].data || {},
      resumeFile: files[fileKey(id, "resume")] || null,
      coverLetterFile: files[fileKey(id, "cover")] || null,
      settings
    };
  }

  async function setActive(id) { await S().set({ activeProfileId: id }); }

  async function create(name, data) {
    const { profiles, profileOrder } = await ensure();
    const id = newId();
    profiles[id] = { name, data };
    profileOrder.push(id);
    await S().set({ profiles, profileOrder });
    return id;
  }

  // Copy a profile's info. Resume/cover files are copied only when asked, so a
  // new profile doesn't quietly send the old resume.
  async function duplicate(srcId, name, { files: copyFiles = false } = {}) {
    const { profiles } = await ensure();
    const id = await create(name, JSON.parse(JSON.stringify(profiles[srcId].data)));
    if (!copyFiles) return id;
    const files = await S().get([fileKey(srcId, "resume"), fileKey(srcId, "cover")]);
    const copy = {};
    if (files[fileKey(srcId, "resume")]) copy[fileKey(id, "resume")] = files[fileKey(srcId, "resume")];
    if (files[fileKey(srcId, "cover")]) copy[fileKey(id, "cover")] = files[fileKey(srcId, "cover")];
    if (Object.keys(copy).length) await S().set(copy);
    return id;
  }

  async function rename(id, name) {
    const { profiles } = await ensure();
    if (!profiles[id]) return;
    profiles[id].name = name;
    await S().set({ profiles });
  }

  async function saveData(id, data) {
    const { profiles } = await ensure();
    if (!profiles[id]) return;
    profiles[id].data = data;
    await S().set({ profiles });
  }

  async function remove(id) {
    let { profiles, profileOrder, activeProfileId } = await ensure();
    delete profiles[id];
    profileOrder = profileOrder.filter(x => x !== id);
    if (activeProfileId === id) activeProfileId = profileOrder[0] || null;
    await S().set({ profiles, profileOrder, activeProfileId });
    await S().remove([fileKey(id, "resume"), fileKey(id, "cover")]);
  }

  g.JAF_STORE = { ensure, list, loadForFill, setActive, create, duplicate, rename, saveData, remove, fileKey, newId };
})();
