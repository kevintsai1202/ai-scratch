/**
 * app.js — 應用整合層
 *
 * 職責：Blockly 工作區初始化、角色管理（每角色一份積木程式）、
 * 執行流程（產生程式碼 → 建 Runtime → 跑）、儲存／開啟／分享 UI、播放模式。
 */
const App = (() => {
  'use strict';

  /** 預設造型輪替表（新增角色時依序取用） */
  const DEFAULT_COSTUMES = ['🐱', '🐶', '🦊', '🐸', '👾', '🚀', '⚽', '🍎', '⭐', '💎', '🎈', '🏀'];

  /* ── 應用狀態 ── */
  let project = null;          // 目前作品 { name, sprites[] }
  let selectedSpriteId = null; // 編輯中的角色 id
  let workspace = null;        // Blockly 主工作區（顯示選取角色的程式）
  let currentRuntime = null;   // 執行中的 Runtime（未執行為 null）
  let running = false;         // 是否在執行狀態
  let loadingWorkspace = false;// 換載角色程式時抑制 change 事件
  let stage = null;            // Stage 渲染器
  let dragging = null;         // 編輯模式拖曳角色狀態 { sprite }

  const $ = (id) => document.getElementById(id);

  /* ════════════ 初始化 ════════════ */

  function init() {
    stage = new Stage($('stage'));

    // Blockly 主工作區：zelos 渲染器外觀最接近 Scratch
    javascript.javascriptGenerator.addReservedWords('runtime,sprite');
    workspace = Blockly.inject('blocklyDiv', {
      toolbox: window.TOOLBOX,
      renderer: 'zelos',
      zoom: { controls: true, wheel: true, startScale: 0.8 },
      trashcan: true,
      grid: { spacing: 24, length: 2, colour: '#d8e4f3', snap: false },
    });

    // 積木有變動 → 回寫到角色資料並自動保存（debounce）
    workspace.addChangeListener((e) => {
      if (loadingWorkspace || e.isUiEvent) return;
      scheduleAutosave();
    });

    bindToolbar();
    bindStageMouse();
    bindKeyboard();
    bindSpriteProps();
    UIVoice.init(); // 注音標示＋選單點選語音（需在 Blockly 注入後）
    Mobile.setup(); // 觸控裝置：浮動執行鈕＋虛擬按鍵＋捲回頂端
    AIInput.setup(); // AI 面板初始化
    requestAnimationFrame(renderLoop);

    // 偵測 /play/:id 路徑（後端分享連結）
    const playMatch = location.pathname.match(/^\/play\/([A-Za-z0-9_-]+)$/);
    if (playMatch) {
      Storage.loadFromServer(playMatch[1]).then(proj => {
        if (proj) { setProject(proj); enterPlayMode(); }
        else { toast('找不到這個作品'); setProject(Storage.loadAutosave() || defaultProject()); }
      });
      return; // async 載入，跳過後面的同步邏輯
    }

    // 進入點：網址帶分享作品 → 播放模式；否則還原自動保存或建新作品
    const shared = Storage.projectFromHash();
    if (shared) {
      setProject(shared);
      enterPlayMode();
    } else {
      setProject(Storage.loadAutosave() || defaultProject());
      Mobile.maybeShowEditorTip();   // 手機開編輯器 → 提示建議用電腦
      Tutorial.maybeAutoStart();     // 第一次來 → 自動開始闖關教學
    }

    // 在同一分頁貼上別人的分享連結 → 直接重載生效
    window.addEventListener('hashchange', () => location.reload());
  }

  /** 建立預設作品：一隻貓在原點 */
  function defaultProject() {
    return { name: '我的遊戲', sprites: [makeSprite('🐱', '貓咪')] };
  }

  /** 建立角色設定 */
  function makeSprite(costume, name) {
    return {
      id: 's' + Math.random().toString(36).slice(2, 9),
      name, costume,
      x: 0, y: 0, dir: 90, size: 100, visible: true,
      workspace: null, // Blockly 序列化 JSON
    };
  }

  /* ════════════ 作品／角色管理 ════════════ */

  /** 切換整份作品（載入、新作品、分享進入都走這裡） */
  function setProject(p) {
    stopRun();
    project = p;
    $('projectName').value = p.name;
    selectSprite(p.sprites[0]?.id ?? null);
    renderSpriteList();
  }

  /** 把主工作區內容回寫到目前選取角色 */
  function syncCurrentWorkspace() {
    const sp = selectedSprite();
    if (sp && workspace) sp.workspace = Blockly.serialization.workspaces.save(workspace);
  }

  function selectedSprite() {
    return project?.sprites.find(s => s.id === selectedSpriteId) || null;
  }

  /** 選取角色：先存舊角色程式，再載入新角色程式 */
  function selectSprite(id) {
    syncCurrentWorkspace();
    selectedSpriteId = id;
    const sp = selectedSprite();
    loadingWorkspace = true;
    try {
      workspace.clear();
      if (sp?.workspace) Blockly.serialization.workspaces.load(sp.workspace, workspace);
    } finally { loadingWorkspace = false; }
    renderSpriteList();
    renderProps();
  }

  /** 「碰到 [角色]？」下拉用：目前作品所有角色名稱 */
  function spriteOptions() {
    return (project?.sprites || []).map(s => [s.name, s.name]);
  }

  /* ── 角色清單 UI ── */

  function renderSpriteList() {
    const list = $('spriteList');
    list.innerHTML = '';
    for (const s of project.sprites) {
      const card = document.createElement('div');
      card.className = 'sprite-card' + (s.id === selectedSpriteId ? ' selected' : '');
      card.dataset.speak = s.name; // 點角色卡時唸出角色名稱
      card.innerHTML = `<div class="face">${s.costume}</div><div class="name">${escapeHtml(s.name)}</div>` +
        `<div class="del" title="刪除角色">✕</div>`;
      card.addEventListener('click', (e) => {
        if (e.target.classList.contains('del')) { removeSprite(s.id); return; }
        selectSprite(s.id);
      });
      // 雙擊改名
      card.addEventListener('dblclick', () => {
        const name = prompt('角色名稱：', s.name);
        if (name?.trim()) { s.name = name.trim(); renderSpriteList(); scheduleAutosave(); }
      });
      list.appendChild(card);
    }
    const add = document.createElement('button');
    add.className = 'sprite-add';
    add.textContent = '＋';
    add.title = '新增角色';
    add.dataset.speak = '新增角色';
    add.addEventListener('click', addSprite);
    list.appendChild(add);
    window.UIVoice?.annotate(list); // 角色名稱補注音
  }

  function addSprite() {
    const used = new Set(project.sprites.map(s => s.costume));
    const costume = DEFAULT_COSTUMES.find(c => !used.has(c)) || '⭐';
    addSpriteQuick(costume, `角色${project.sprites.length + 1}`);
  }

  /** 以指定造型/名稱新增角色（教學的 ✨幫手也會呼叫），回傳新角色設定 */
  function addSpriteQuick(costume, name) {
    const sp = makeSprite(costume, name);
    // 新角色錯開位置，避免疊在一起
    sp.x = (project.sprites.length % 4) * 60 - 90;
    sp.y = -Math.floor(project.sprites.length / 4) * 60 + 60;
    project.sprites.push(sp);
    selectSprite(sp.id);
    scheduleAutosave();
    return sp;
  }

  /** 直接設定某角色的積木程式（教學的 ✨幫手用）；選取中則同步重載畫面 */
  function setSpriteWorkspace(id, state) {
    const sp = project.sprites.find(s => s.id === id);
    if (!sp) return;
    sp.workspace = state;
    if (id === selectedSpriteId) {
      loadingWorkspace = true;
      try {
        workspace.clear();
        Blockly.serialization.workspaces.load(state, workspace);
      } finally { loadingWorkspace = false; }
    }
    scheduleAutosave();
  }

  function removeSprite(id) {
    if (project.sprites.length <= 1) { toast('至少要保留一個角色'); return; }
    if (!confirm('確定刪除這個角色（含它的積木程式）？')) return;
    project.sprites = project.sprites.filter(s => s.id !== id);
    if (selectedSpriteId === id) selectedSpriteId = null;
    selectSprite(project.sprites[0].id);
    scheduleAutosave();
  }

  /** 清除作品並設定新的角色陣列（AI 多角色生成用） */
  function clearAndSetProject(name, sprites) {
    stopRun();
    project = { name: name || '我的遊戲', sprites };
    $('projectName').value = project.name;
    selectSprite(project.sprites[0]?.id ?? null);
    renderSpriteList();
    scheduleAutosave();
  }

  /* ── 角色屬性面板 ── */

  function renderProps() {
    const sp = selectedSprite();
    if (!sp) return;
    $('propX').value = Math.round(sp.x);
    $('propY').value = Math.round(sp.y);
    $('propDir').value = Math.round(sp.dir);
    $('propSize').value = sp.size;
    $('propVisible').checked = sp.visible;
  }

  function bindSpriteProps() {
    const apply = () => {
      const sp = selectedSprite();
      if (!sp) return;
      sp.x = Number($('propX').value) || 0;
      sp.y = Number($('propY').value) || 0;
      sp.dir = Number($('propDir').value) || 90;
      sp.size = Number($('propSize').value) || 100;
      sp.visible = $('propVisible').checked;
      scheduleAutosave();
    };
    ['propX', 'propY', 'propDir', 'propSize', 'propVisible']
      .forEach(id => $(id).addEventListener('change', apply));
  }

  /* ════════════ 執行流程 ════════════ */

  /** ▶ 執行：為每個角色產生程式碼，建立全新 Runtime 開跑 */
  function run() {
    syncCurrentWorkspace();
    stopRun(); // 先停掉上一輪

    const runtime = new Runtime(project.sprites);
    runtime.onStopAll = () => { running = false; Mobile.onRunStateChanged(); };

    // 逐角色：還原積木 → 產生 JS → 以 (runtime, 該角色) 執行註冊事件
    for (const config of project.sprites) {
      if (!config.workspace) continue;
      let code = '';
      const headless = new Blockly.Workspace();
      try {
        Blockly.serialization.workspaces.load(config.workspace, headless);
        code = javascript.javascriptGenerator.workspaceToCode(headless);
      } catch (err) {
        console.error(`角色「${config.name}」產生程式碼失敗：`, err);
        toast(`角色「${config.name}」的積木有問題，已略過`);
        continue;
      } finally {
        headless.dispose();
      }
      const rtSprite = runtime.sprites.find(s => s.id === config.id);
      try {
        // 必須「同步」呼叫：事件註冊要在 runtime.start() 之前完成
        compileSpriteCode(code)(runtime, rtSprite).catch(err => {
          if (!err?.isStopSignal) console.error(`角色「${config.name}」執行錯誤：`, err);
        });
      } catch (err) {
        console.error(`角色「${config.name}」程式碼執行失敗：`, err);
        toast(`角色「${config.name}」的程式無法執行`);
      }
    }

    currentRuntime = runtime;
    running = true;
    runtime.start();
    Mobile.onRunStateChanged(); // 手機：切換浮動鈕為 ⏹、亮出虛擬按鍵
  }

  /**
   * 把產生的積木程式碼編成 (runtime, sprite) => Promise 的可呼叫函式。
   * 安全性說明：程式碼僅由固定的積木產生器組裝，使用者輸入的文字欄位
   * 一律經 JSON.stringify 轉義為字面值，無原始字串拼接路徑（見設計文件）。
   */
  const JSCompiler = globalThis.Function; // 間接引用，語意同 Function 建構子
  function compileSpriteCode(code) {
    return new JSCompiler('runtime', 'sprite', `return (async () => {\n${code}\n})();`);
  }

  /** ⏹ 停止執行 */
  function stopRun() {
    currentRuntime?.stop();
    currentRuntime = null;
    running = false;
    window.Mobile?.onRunStateChanged(); // init 流程中 Mobile 可能尚未載入完成
  }

  /** 全域渲染迴圈：執行中畫 Runtime 狀態，否則畫編輯器擺位 */
  function renderLoop() {
    if (running && currentRuntime) {
      stage.render(currentRuntime.sprites, currentRuntime.vars, null);
    } else if (project) {
      // 播放模式（分享連結）不顯示編輯用的選取虛線框
      const inPlayMode = $('playOverlay').classList.contains('active');
      stage.render(project.sprites, {}, inPlayMode ? null : selectedSpriteId);
    }
    requestAnimationFrame(renderLoop);
  }

  /* ════════════ 輸入事件 ════════════ */

  function bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (e.target.matches('input, textarea')) return; // 打字時不攔截
      const key = normalizeKey(e.key);
      KEYS_DOWN.add(key);
      if (running) {
        currentRuntime?.fireKey(key);
        // 避免方向鍵／空白鍵捲動頁面
        if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => KEYS_DOWN.delete(normalizeKey(e.key)));
    window.addEventListener('blur', () => KEYS_DOWN.clear());
  }

  /** 鍵值正規化：單一字母統一小寫（避免 Shift 影響） */
  function normalizeKey(k) { return k.length === 1 ? k.toLowerCase() : k; }

  /**
   * 綁定舞台滑鼠與觸控事件，支援桌面滑鼠及手機/平板觸控拖曳角色。
   * 將 mousedown/mousemove 的共用邏輯抽成 handlePointerDown / handlePointerMove，
   * touch 事件直接呼叫相同函式，避免重複程式碼。
   */
  function bindStageMouse() {
    const canvas = $('stage');

    /** 將滑鼠事件或 Touch 物件的 clientX/clientY 轉換為 canvas 內部座標 */
    const toCanvasXY = (e) => {
      const r = canvas.getBoundingClientRect();
      return [(e.clientX - r.left) * (canvas.width / r.width), (e.clientY - r.top) * (canvas.height / r.height)];
    };

    /**
     * 處理按下/觸碰開始事件的共用邏輯：
     * - 執行中：hitTest → fireClick 觸發「當角色被點擊」積木
     * - 編輯中：hitTest → selectSprite 並設定 dragging 開始拖曳
     * @param {number} px - canvas 內部 X 座標
     * @param {number} py - canvas 內部 Y 座標
     */
    function handlePointerDown(px, py) {
      if (running && currentRuntime) {
        // 執行中：點到角色 → 觸發「當角色被點擊」
        const hit = stage.hitTest(currentRuntime.sprites, px, py);
        if (hit) currentRuntime.fireClick(hit);
      } else {
        // 編輯中：點到角色 → 選取並開始拖曳擺位
        const hit = stage.hitTest(project.sprites, px, py);
        if (hit) {
          if (hit.id !== selectedSpriteId) selectSprite(hit.id);
          dragging = { sprite: hit };
        }
      }
    }

    /**
     * 處理移動/拖曳事件的共用邏輯：
     * 更新被拖曳角色的舞台座標，並重新渲染屬性面板。
     * @param {number} px - canvas 內部 X 座標
     * @param {number} py - canvas 內部 Y 座標
     */
    function handlePointerMove(px, py) {
      if (!dragging || running) return;
      const [sx, sy] = stage.toStage(px, py);
      dragging.sprite.x = Math.round(sx);
      dragging.sprite.y = Math.round(sy);
      renderProps();
    }

    // 滑鼠事件：呼叫共用 handler
    canvas.addEventListener('mousedown', (e) => {
      const [px, py] = toCanvasXY(e);
      handlePointerDown(px, py);
    });
    canvas.addEventListener('mousemove', (e) => {
      const [px, py] = toCanvasXY(e);
      handlePointerMove(px, py);
    });
    window.addEventListener('mouseup', () => {
      if (dragging) { dragging = null; scheduleAutosave(); }
    });

    // 觸控事件：手機/平板拖曳角色支援
    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault(); // 阻止捲動，確保拖曳生效
      const [px, py] = toCanvasXY(e.touches[0]);
      handlePointerDown(px, py);
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault(); // 阻止捲動，確保拖曳生效
      const [px, py] = toCanvasXY(e.touches[0]);
      handlePointerMove(px, py);
    }, { passive: false });
    window.addEventListener('touchend', () => {
      if (dragging) { dragging = null; scheduleAutosave(); }
    });
  }

  /* ════════════ 工具列：新作品／儲存／開啟／分享 ════════════ */

  function bindToolbar() {
    $('btnRun').addEventListener('click', run);
    $('btnStop').addEventListener('click', stopRun);
    $('btnTutorial').addEventListener('click', () => Tutorial.start());
    $('btnAI').addEventListener('click', () => AIInput.togglePanel());

    $('projectName').addEventListener('change', () => {
      project.name = $('projectName').value.trim() || '未命名';
      scheduleAutosave();
    });

    $('btnNew').addEventListener('click', () => {
      if (!confirm('開新作品？目前未儲存的內容會被自動保存覆蓋。')) return;
      setProject(defaultProject());
      scheduleAutosave();
    });

    $('btnSave').addEventListener('click', () => {
      syncCurrentWorkspace();
      project.name = $('projectName').value.trim() || '未命名';
      Storage.saveProject(project);
      toast(`已儲存「${project.name}」`);
    });

    $('btnOpen').addEventListener('click', showOpenDialog);

    $('btnShare').addEventListener('click', async () => {
      syncCurrentWorkspace();
      try {
        const id = await Storage.shareToServer(project);
        const url = `${location.origin}/play/${id}`;
        try {
          await navigator.clipboard.writeText(url);
          toast('🔗 分享連結已複製，傳給朋友就能玩！');
        } catch {
          prompt('複製這個連結分享給朋友：', url);
        }
      } catch {
        // 後端不可用時退回 LZ-String hash 分享
        const url = Storage.shareUrl(project);
        try {
          await navigator.clipboard.writeText(url);
          toast('🔗 分享連結已複製（離線模式）');
        } catch {
          prompt('複製這個連結分享給朋友：', url);
        }
      }
    });
  }

  /** 開啟作品對話框 */
  function showOpenDialog() {
    const dialog = $('openDialog');
    const list = $('projList');
    const names = Storage.listNames();
    list.innerHTML = names.length ? '' : '<p style="color:#888">還沒有儲存過作品</p>';
    for (const name of names) {
      const row = document.createElement('div');
      row.className = 'proj-row';
      row.innerHTML = `<span class="pname">${escapeHtml(name)}</span>` +
        `<button class="open">開啟</button><button class="remove">刪除</button>`;
      row.querySelector('.open').addEventListener('click', () => {
        setProject(JSON.parse(JSON.stringify(Storage.loadProject(name)))); // 深拷貝避免共用參照
        dialog.close();
        toast(`已開啟「${name}」`);
      });
      row.querySelector('.open').dataset.speak = '開啟';
      row.querySelector('.remove').dataset.speak = '刪除';
      row.querySelector('.remove').addEventListener('click', () => {
        if (confirm(`刪除作品「${name}」？`)) { Storage.deleteProject(name); showOpenDialog(); }
      });
      list.appendChild(row);
    }
    window.UIVoice?.annotate(dialog); // 對話框文字補注音
    dialog.showModal();
  }

  /* ════════════ 播放模式（開啟分享連結時） ════════════ */

  function enterPlayMode() {
    $('playTitle').textContent = `🎮 ${project.name}`;
    $('playStageSlot').appendChild($('stageWrap')); // 把舞台搬進遮罩
    $('playOverlay').classList.add('active');
    Mobile.onEnterPlayMode(); // 手機：縮放舞台＋建立虛擬按鍵
    $('btnPlayBig').onclick = run;
    $('btnEditShared').onclick = () => {
      stopRun();
      $('playOverlay').classList.remove('active');
      // 把舞台搬回編輯版面（放回控制列之後）
      const aside = document.querySelector('aside');
      aside.insertBefore($('stageWrap'), aside.querySelector('.sprite-panel'));
      history.replaceState(null, '', location.pathname); // 清掉 hash，避免重整又進播放模式
      Mobile.onExitPlayMode(); // 還原舞台縮放
      scheduleAutosave();
    };
  }

  /* ════════════ 雜項 ════════════ */

  let autosaveTimer = null;
  /** 自動保存（500ms debounce；播放模式不覆蓋使用者自己的作品） */
  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      if ($('playOverlay').classList.contains('active')) return;
      syncCurrentWorkspace();
      Storage.autosave(project);
    }, 500);
  }

  let toastTimer = null;
  /** 底部 toast 提示 */
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  document.addEventListener('DOMContentLoaded', init);

  // 頂層 const 不會自動掛上 window；blocks.js 的動態下拉以 window.App 防呆檢查，需明確掛上

  // 對外介面（blocks.js 的動態下拉與測試會用到）
  return {
    spriteOptions, run, stopRun,
    addSpriteQuick, setSpriteWorkspace, clearAndSetProject,
    get project() { return project; },
    get runtime() { return currentRuntime; }, // e2e 驗證執行期狀態用
  };
})();
window.App = App;
