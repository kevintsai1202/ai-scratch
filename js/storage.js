/**
 * storage.js — 作品儲存（localStorage）與分享連結編解碼（LZ-String → URL hash）
 *
 * 作品（project）資料格式：
 * {
 *   name: '我的遊戲',
 *   sprites: [{ id, name, costume, x, y, dir, size, visible, workspace: <Blockly序列化JSON> }]
 * }
 */
const Storage = (() => {
  /** localStorage 鍵名 */
  const KEY_PROJECTS = 'scratchy.projects'; // { 名稱: project }
  const KEY_AUTOSAVE = 'scratchy.autosave'; // 最近一次編輯內容（防遺失）

  /** 讀出所有已儲存作品（毀損時回空表） */
  function allProjects() {
    try { return JSON.parse(localStorage.getItem(KEY_PROJECTS)) || {}; }
    catch { return {}; }
  }

  /** 儲存作品（同名覆蓋） */
  function saveProject(project) {
    const all = allProjects();
    all[project.name] = project;
    localStorage.setItem(KEY_PROJECTS, JSON.stringify(all));
  }

  /** 依名稱載入作品；不存在回 null */
  function loadProject(name) { return allProjects()[name] || null; }

  /** 刪除作品 */
  function deleteProject(name) {
    const all = allProjects();
    delete all[name];
    localStorage.setItem(KEY_PROJECTS, JSON.stringify(all));
  }

  /** 作品名稱清單 */
  function listNames() { return Object.keys(allProjects()); }

  /** 自動保存／還原（每次編輯防呆，與正式儲存分開） */
  function autosave(project) {
    try { localStorage.setItem(KEY_AUTOSAVE, JSON.stringify(project)); } catch { /* 容量滿時忽略 */ }
  }
  function loadAutosave() {
    try { return JSON.parse(localStorage.getItem(KEY_AUTOSAVE)); } catch { return null; }
  }

  /** 作品 → 分享網址（壓縮後放在 #p=，純前端即可還原） */
  function shareUrl(project) {
    const packed = LZString.compressToEncodedURIComponent(JSON.stringify(project));
    return `${location.origin}${location.pathname}#p=${packed}`;
  }

  /** 從目前網址 hash 解析分享作品；無或毀損回 null */
  function projectFromHash() {
    const m = location.hash.match(/^#p=(.+)$/);
    if (!m) return null;
    try {
      const json = LZString.decompressFromEncodedURIComponent(m[1]);
      const project = JSON.parse(json);
      if (!project || !Array.isArray(project.sprites)) return null;
      return project;
    } catch { return null; }
  }

  /** 上傳作品到後端，回傳短 ID */
  async function shareToServer(project) {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: project.name, sprites: project.sprites }),
    });
    if (!res.ok) throw new Error('儲存失敗');
    const { id } = await res.json();
    return id;
  }

  /** 從後端讀取作品；不存在時回 null */
  async function loadFromServer(id) {
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return { name: data.name, sprites: data.sprites };
  }

  return { saveProject, loadProject, deleteProject, listNames, autosave, loadAutosave, shareUrl, projectFromHash, shareToServer, loadFromServer };
})();
