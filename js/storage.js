/**
 * storage.js — 作品儲存（資料庫）與分享連結
 *
 * 儲存作品存到後端資料庫（type='save'），localStorage 僅做自動保存暫存。
 * 分享會建立不可變快照（type='share'），修改原作品不影響已分享的連結。
 *
 * 作品（project）資料格式：
 * {
 *   name: '我的遊戲',
 *   sprites: [{ id, name, costume, x, y, dir, size, visible, workspace }],
 *   _saveId: '儲存用的資料庫 ID（首次儲存後自動產生）'
 * }
 */
const Storage = (() => {
  /** localStorage 鍵名（僅用於自動保存暫存） */
  const KEY_AUTOSAVE = 'scratchy.autosave';

  /** 自動保存／還原（編輯中防當機，與正式儲存分開） */
  function autosave(project) {
    try { localStorage.setItem(KEY_AUTOSAVE, JSON.stringify(project)); } catch { /* 容量滿時忽略 */ }
  }
  function loadAutosave() {
    try { return JSON.parse(localStorage.getItem(KEY_AUTOSAVE)); } catch { return null; }
  }

  /**
   * 儲存作品到資料庫（有 _saveId 則更新，否則建立新作品）
   * @param {object} project - 作品物件
   * @returns {Promise<string>} 儲存後的 ID
   */
  async function saveProject(project) {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: project.name,
        sprites: project.sprites,
        type: 'save',
        saveId: project._saveId || undefined,
      }),
    });
    if (!res.ok) throw new Error('儲存失敗');
    const { id } = await res.json();
    project._saveId = id;
    return id;
  }

  /**
   * 從資料庫載入作品
   * @param {string} id - 作品 ID
   * @returns {Promise<object|null>} 作品物件或 null
   */
  async function loadProject(id) {
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const data = await res.json();
    const project = { name: data.name, sprites: data.sprites, _saveId: id };
    return project;
  }

  /**
   * 列出所有儲存的作品（不含分享快照）
   * @returns {Promise<Array<{id, name, updated_at}>>} 作品摘要列表
   */
  async function listProjects() {
    const res = await fetch('/api/projects');
    if (!res.ok) return [];
    return res.json();
  }

  /**
   * 刪除儲存的作品
   * @param {string} id - 作品 ID
   */
  async function deleteProject(id) {
    await fetch(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
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

  /**
   * 上傳作品快照到後端（分享用，不可變）
   * @param {object} project - 作品物件
   * @returns {Promise<string>} 分享用短 ID
   */
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

  /**
   * 從後端讀取作品（分享連結載入用）
   * @param {string} id - 作品 ID
   * @returns {Promise<object|null>} 作品物件或 null
   */
  async function loadFromServer(id) {
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return { name: data.name, sprites: data.sprites };
  }

  return {
    autosave, loadAutosave,
    saveProject, loadProject, listProjects, deleteProject,
    shareUrl, projectFromHash, shareToServer, loadFromServer,
  };
})();
