# 積木遊戲工坊 — 六功能擴充實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 為積木遊戲工坊新增觸控拖拉、後端儲存分享、AI 生積木、Clone 分身、多角色 AI、帥氣模式六項功能。

**Architecture:** 前端保持純靜態 JS（無建置步驟），新增 `server/` 目錄放 Express + SQLite 後端。AI 功能由後端代理呼叫 Zeabur AI Hub，前端新增 `js/ai-input.js` 處理 DSL 轉 Blockly。帥氣模式渲染獨立為 `js/fancy.js` 避免 engine.js 膨脹。

**Tech Stack:** Express, better-sqlite3, nanoid, dotenv（後端）；Blockly v12, Web Speech API, Canvas 2D（前端）

**依賴順序：** Task 1（觸控）→ 獨立；Task 2（Clone）→ Task 5、6 前置；Task 3（後端）→ Task 4、5 前置；Task 4（AI 單角色）→ Task 5 前置；Task 5（AI 多角色）；Task 6（帥氣模式）→ 需 Task 2

---

### Task 1: 觸控拖拉角色

**Files:**
- Modify: `js/app.js:318-351`（`bindStageMouse` 函式）
- Modify: `index.html:62`（canvas CSS 加 `touch-action: none`）

- [ ] **Step 1: 在 index.html 的 canvas CSS 加入 touch-action: none**

在 `index.html:62` 的 `canvas#stage` 規則裡加入 `touch-action: none;`：

```css
canvas#stage {
  width: 480px; height: 360px; background: #fff;
  border: 2px solid #b3c7e6; border-radius: 8px; display: block;
  touch-action: none;
}
```

- [ ] **Step 2: 重構 toCanvasXY 支援 touch 和 mouse**

在 `js/app.js` 的 `bindStageMouse()` 裡，把現有的 `toCanvasXY` 改為同時接受 MouseEvent 和 Touch 物件：

```js
function bindStageMouse() {
  const canvas = $('stage');
  /** 從 MouseEvent 或 Touch 取得 canvas 內座標 */
  const toCanvasXY = (e) => {
    const r = canvas.getBoundingClientRect();
    const cx = (e.clientX - r.left) * (canvas.width / r.width);
    const cy = (e.clientY - r.top) * (canvas.height / r.height);
    return [cx, cy];
  };
```

這段跟原本一樣（MouseEvent 和 Touch 都有 `clientX/clientY`），不需改簽章。

- [ ] **Step 3: 抽出 handlePointerDown / handlePointerMove 共用邏輯**

在 `bindStageMouse()` 內新增兩個內部函式，讓 mouse 和 touch 共用：

```js
  /** 按下/觸碰處理（mouse 和 touch 共用） */
  function handlePointerDown(px, py) {
    if (running && currentRuntime) {
      const hit = stage.hitTest(currentRuntime.sprites, px, py);
      if (hit) currentRuntime.fireClick(hit);
    } else {
      const hit = stage.hitTest(project.sprites, px, py);
      if (hit) {
        if (hit.id !== selectedSpriteId) selectSprite(hit.id);
        dragging = { sprite: hit };
      }
    }
  }

  /** 移動處理（mouse 和 touch 共用） */
  function handlePointerMove(px, py) {
    if (!dragging || running) return;
    const [sx, sy] = stage.toStage(px, py);
    dragging.sprite.x = Math.round(sx);
    dragging.sprite.y = Math.round(sy);
    renderProps();
  }
```

- [ ] **Step 4: 將現有 mouse 事件改用共用函式**

將原本 `mousedown` 和 `mousemove` 的 handler 改為呼叫共用函式：

```js
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
```

- [ ] **Step 5: 新增 touch 事件監聽**

在 `mouseup` 監聽之後加入 touch 事件：

```js
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const [px, py] = toCanvasXY(e.touches[0]);
    handlePointerDown(px, py);
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const [px, py] = toCanvasXY(e.touches[0]);
    handlePointerMove(px, py);
  }, { passive: false });
  window.addEventListener('touchend', () => {
    if (dragging) { dragging = null; scheduleAutosave(); }
  });
```

- [ ] **Step 6: 手動測試觸控拖拉**

用 Chrome DevTools 切換到手機模擬模式（Toggle device toolbar），開啟 `index.html`：
1. 觸碰舞台上的角色 → 應選取並可拖曳
2. 執行中觸碰角色 → 應觸發「當角色被點擊」
3. 拖曳時畫面不應跟著滾動

- [ ] **Step 7: Commit**

```bash
git add js/app.js index.html
git commit -m "feat: 觸控拖拉角色（手機/平板可在舞台上拖曳）"
```

---

### Task 2: Clone 分身積木

**Files:**
- Modify: `js/engine.js`（RuntimeSprite + Runtime 類別）
- Modify: `js/blocks.js`（新積木定義 + 產生器 + 工具箱）

- [ ] **Step 1: 在 RuntimeSprite 建構子加入 clone 屬性**

在 `js/engine.js` 的 `RuntimeSprite` 建構子最後加兩個屬性：

```js
class RuntimeSprite {
  constructor(config, runtime) {
    this.runtime = runtime;
    this.id = config.id;
    this.name = config.name;
    this.costume = config.costume;
    this.x = config.x;
    this.y = config.y;
    this.dir = config.dir;
    this.size = config.size;
    this.visible = config.visible;
    this.sayText = '';
    this.isClone = false;
    this.cloneParentId = null;
  }
```

- [ ] **Step 2: 在 Runtime 加入分身上限常數和 cloneHandlers**

在 `js/engine.js` 的 `Runtime` 建構子裡加入：

```js
class Runtime {
  constructor(spriteConfigs) {
    this.stopped = false;
    this.vars = Object.create(null);
    this.sprites = spriteConfigs.map(c => new RuntimeSprite(c, this));
    this.flagHandlers = [];
    this.keyHandlers = [];
    this.clickHandlers = [];
    this.cloneHandlers = [];
  }
```

並在檔案頂部（`SPRITE_BASE_SIZE` 之後）加入常數：

```js
/** 分身數量上限（單一角色 60，全域 300） */
const MAX_CLONES_PER_SPRITE = 60;
const MAX_CLONES_TOTAL = 300;
```

- [ ] **Step 3: 在 Runtime 加入 whenCloned / createClone / deleteClone 方法**

在 `Runtime` 類別的 `whenClicked` 之後加入：

```js
  /** 事件註冊：當分身產生 */
  whenCloned(sprite, fn) { this.cloneHandlers.push({ sprite, fn }); }

  /** 產生分身：複製角色狀態，加入 sprites 陣列，觸發 whenCloned handler */
  createClone(sprite) {
    if (this.stopped) return;
    const totalClones = this.sprites.filter(s => s.isClone).length;
    if (totalClones >= MAX_CLONES_TOTAL) return;
    const sameClones = this.sprites.filter(s => s.isClone && s.cloneParentId === sprite.id).length;
    if (sameClones >= MAX_CLONES_PER_SPRITE) return;

    const clone = new RuntimeSprite({
      id: sprite.id,
      name: sprite.name,
      costume: sprite.costume,
      x: sprite.x,
      y: sprite.y,
      dir: sprite.dir,
      size: sprite.size,
      visible: sprite.visible,
    }, this);
    clone.isClone = true;
    clone.cloneParentId = sprite.id;
    this.sprites.push(clone);

    this.cloneHandlers
      .filter(h => h.sprite.id === sprite.id)
      .forEach(h => {
        const cloneFn = h.fn.bind(null, clone);
        this.spawn(() => cloneFn());
      });
  }

  /** 刪除分身（僅分身可刪，本體忽略） */
  deleteClone(sprite) {
    if (!sprite.isClone) return;
    const idx = this.sprites.indexOf(sprite);
    if (idx !== -1) this.sprites.splice(idx, 1);
  }
```

- [ ] **Step 4: 修改 whenCloned handler 簽章讓 fn 接收 clone sprite**

clone handler 需要用分身（而非本體）作為 sprite 執行。上面的 `createClone` 裡已經用 `h.fn.bind(null, clone)` 傳入 clone。對應的積木產生器需要讓 fn 接受一個 sprite 參數。

- [ ] **Step 5: 在 blocks.js 新增三個分身積木定義**

在 `js/blocks.js` 的 `Blockly.common.defineBlocksWithJsonArray([...])` 的控制區塊之後（`control_stop` 之後），加入：

```js
    // ── 分身 ──
    { type: 'control_clone', message0: '產生自己的分身',
      previousStatement: null, nextStatement: null, colour: C.control },
    { type: 'control_delete_clone', message0: '刪除這個分身',
      previousStatement: null, colour: C.control },
    { type: 'event_whencloned', message0: '當分身產生時 %1 %2',
      args0: [{ type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }],
      colour: C.event, tooltip: '分身被建立時執行此程式' },
```

- [ ] **Step 6: 在 blocks.js 新增三個分身積木的程式碼產生器**

在 `control_stop` 的產生器之後加入：

```js
  G.forBlock['control_clone'] = () => `runtime.createClone(sprite);\n`;
  G.forBlock['control_delete_clone'] = () => `runtime.deleteClone(sprite);\n`;
  G.forBlock['event_whencloned'] = (block, gen) => {
    const body = gen.statementToCode(block, 'DO');
    return `runtime.whenCloned(sprite, async (__cloneSprite) => {\nconst sprite = __cloneSprite;\n${body}});\n`;
  };
```

注意 `event_whencloned` 產生器裡用 `const sprite = __cloneSprite;` 覆蓋外層的 sprite 變數，這樣 body 裡的 `sprite.move()` 等積木操作的是分身而非本體。

- [ ] **Step 7: 在工具箱加入分身積木**

在 `js/blocks.js` 的 `window.TOOLBOX` 中，控制分類的 contents 裡 `control_stop` 之後加入：

```js
        { kind: 'block', type: 'control_clone' },
        { kind: 'block', type: 'control_delete_clone' },
```

在事件分類的 contents 裡 `event_whenclicked` 之後加入：

```js
        { kind: 'block', type: 'event_whencloned' },
```

- [ ] **Step 8: 手動測試分身功能**

用瀏覽器開啟 `index.html`，測試以下場景：
1. 拖一個「當 ▶ 被點擊」→「重複無限次」→「產生自己的分身」→「等待 1 秒」
2. 拖一個「當分身產生時」→「移到 x: 隨機數 y: 隨機數」→「說 我是分身」
3. 按 ▶ → 每秒應出現一個分身在隨機位置說「我是分身」
4. 分身超過 60 個後不再增加（console 無錯誤）
5. 按 ⏹ → 所有分身消失

- [ ] **Step 9: Commit**

```bash
git add js/engine.js js/blocks.js
git commit -m "feat: Clone 分身積木（產生分身/當分身產生/刪除分身）"
```

---

### Task 3: 後端 API Server

**Files:**
- Create: `server/index.js`
- Create: `server/db.js`
- Create: `server/routes/projects.js`
- Create: `.env`
- Modify: `package.json`

- [ ] **Step 1: 安裝後端依賴**

```bash
npm install express better-sqlite3 nanoid@3 dotenv cors
```

使用 `nanoid@3` 是因為 v3 支援 CommonJS（`require`），v4+ 只支援 ESM。

- [ ] **Step 2: 建立 server/db.js**

```js
/**
 * db.js — SQLite 資料庫初始化與作品 CRUD
 */
const Database = require('better-sqlite3');
const path = require('path');

/** 資料庫檔案路徑（可透過環境變數指定，預設在專案根目錄） */
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'scratchy.db');
const db = new Database(DB_PATH);

/** 初始化資料表 */
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
  )
`);

/** 儲存作品（id 重複時更新） */
const upsertStmt = db.prepare(`
  INSERT INTO projects (id, name, data, created_at, updated_at)
  VALUES (?, ?, ?, unixepoch(), unixepoch())
  ON CONFLICT(id) DO UPDATE SET name=excluded.name, data=excluded.data, updated_at=unixepoch()
`);
function saveProject(id, name, data) {
  upsertStmt.run(id, name, data);
}

/** 依 ID 讀取作品；不存在回 null */
const getStmt = db.prepare('SELECT id, name, data, created_at, updated_at FROM projects WHERE id = ?');
function getProject(id) {
  return getStmt.get(id) || null;
}

module.exports = { saveProject, getProject };
```

- [ ] **Step 3: 建立 server/routes/projects.js**

```js
/**
 * routes/projects.js — 作品儲存/讀取 API
 */
const { Router } = require('express');
const { nanoid } = require('nanoid');
const db = require('../db');

const router = Router();

/** POST /api/projects — 儲存作品，回傳短 ID */
router.post('/', (req, res) => {
  const { name, sprites } = req.body;
  if (!name || !Array.isArray(sprites)) {
    return res.status(400).json({ error: '需要 name 和 sprites 欄位' });
  }
  const id = nanoid(7);
  const data = JSON.stringify({ name, sprites });
  db.saveProject(id, name, data);
  res.json({ id });
});

/** GET /api/projects/:id — 讀取作品 */
router.get('/:id', (req, res) => {
  const row = db.getProject(req.params.id);
  if (!row) return res.status(404).json({ error: '找不到這個作品' });
  const project = JSON.parse(row.data);
  res.json({ id: row.id, ...project });
});

module.exports = router;
```

- [ ] **Step 4: 建立 server/index.js**

```js
/**
 * server/index.js — Express 入口
 *
 * 掛載 API 路由 + 靜態檔案服務。
 * /play/:id 回傳前端 index.html，由前端 JS 讀取路徑決定是否進入播放模式。
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const projectsRouter = require('./routes/projects');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '5mb' }));

/** API 路由 */
app.use('/api/projects', projectsRouter);

/** 靜態檔案：serve 專案根目錄（index.html, js/, 等） */
app.use(express.static(path.join(__dirname, '..')));

/** /play/:id — 回傳同一份 index.html，前端讀 URL path 決定播放模式 */
app.get('/play/:id', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`積木遊戲工坊 server 啟動：http://localhost:${PORT}`);
});
```

- [ ] **Step 5: 建立 .env 範本**

```
PORT=3000
AI_API_KEY=your-zeabur-ai-hub-key
AI_BASE_URL=https://ai.zeabur.com/v1
AI_MODEL=gpt-4o-mini
```

- [ ] **Step 6: 更新 package.json 加入 start 腳本**

在 `package.json` 的 `scripts` 裡加入：

```json
"scripts": {
  "start": "node server/index.js",
  "test": "echo \"Error: no test specified\" && exit 1"
}
```

- [ ] **Step 7: 建立 .gitignore 排除不需追蹤的檔案**

```
node_modules/
scratchy.db
.env
```

- [ ] **Step 8: 啟動 server 測試基本 API**

```bash
npm start
```

然後用 curl 測試：

```bash
# 儲存作品
curl -X POST http://localhost:3000/api/projects \
  -H "Content-Type: application/json" \
  -d '{"name":"測試","sprites":[{"id":"s1","name":"貓","costume":"🐱","x":0,"y":0,"dir":90,"size":100,"visible":true,"workspace":null}]}'

# 應回傳 {"id":"xxxxxxx"}

# 讀取作品（用上面回傳的 id）
curl http://localhost:3000/api/projects/xxxxxxx

# 測試不存在的 ID
curl http://localhost:3000/api/projects/notexist
# 應回傳 404 {"error":"找不到這個作品"}

# 測試 /play/:id 回傳 HTML
curl -I http://localhost:3000/play/xxxxxxx
# Content-Type 應為 text/html
```

- [ ] **Step 9: Commit**

```bash
git add server/ .env package.json package-lock.json .gitignore
git commit -m "feat: 後端 API Server（Express + SQLite 作品儲存/讀取）"
```

---

### Task 4: 前端串接後端分享 + AI 自然語言生積木

**Files:**
- Modify: `js/storage.js`（新增 server API 函式）
- Modify: `js/app.js`（分享按鈕改用後端、偵測 /play/:id 路徑）
- Create: `js/ai-input.js`（DSL→Blockly 轉換 + AI 面板 UI + 語音輸入）
- Create: `server/routes/ai.js`（AI 代理路由）
- Modify: `server/index.js`（掛載 ai 路由）
- Modify: `index.html`（加入 AI 按鈕 + 載入 ai-input.js + AI 面板樣式）

- [ ] **Step 1: 在 storage.js 新增 shareToServer 和 loadFromServer**

在 `js/storage.js` 的 `return` 語句之前加入兩個函式：

```js
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
```

並在 `return` 裡加入這兩個函式：

```js
  return { saveProject, loadProject, deleteProject, listNames, autosave, loadAutosave, shareUrl, projectFromHash, shareToServer, loadFromServer };
```

- [ ] **Step 2: 修改 app.js 分享按鈕改用後端**

在 `js/app.js` 的 `bindToolbar()` 裡，把 `$('btnShare')` 的 click handler 改為：

```js
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
        const url = Storage.shareUrl(project);
        try {
          await navigator.clipboard.writeText(url);
          toast('🔗 分享連結已複製（離線模式）');
        } catch {
          prompt('複製這個連結分享給朋友：', url);
        }
      }
    });
```

後端不可用時退回原本的 LZ-String hash 分享。

- [ ] **Step 3: 修改 app.js init 偵測 /play/:id 路徑**

在 `js/app.js` 的 `init()` 函式裡，在 `const shared = Storage.projectFromHash();` 之前加入 `/play/:id` 路徑偵測：

```js
    // 進入點：/play/:id 或 #p= 分享作品 → 播放模式
    const playMatch = location.pathname.match(/^\/play\/([A-Za-z0-9_-]+)$/);
    if (playMatch) {
      Storage.loadFromServer(playMatch[1]).then(proj => {
        if (proj) { setProject(proj); enterPlayMode(); }
        else { toast('找不到這個作品'); setProject(Storage.loadAutosave() || defaultProject()); }
      });
      return;
    }

    const shared = Storage.projectFromHash();
```

注意：因為 `loadFromServer` 是 async，這裡需要提前 return 避免繼續執行後面的同步載入邏輯。

- [ ] **Step 4: 建立 server/routes/ai.js**

```js
/**
 * routes/ai.js — AI 自然語言生積木代理
 *
 * 接收前端的中文指令，呼叫 Zeabur AI Hub（OpenAI 相容格式），
 * 回傳中間 DSL 格式供前端轉換為 Blockly 積木。
 */
const { Router } = require('express');
const router = Router();

/** 可用積木的 DSL 對照表（嵌入 system prompt 供 AI 參考） */
const BLOCK_REFERENCE = `
可用積木（DSL type → 參數 → 說明）：
- event_whenflag：當綠旗被點擊時開始
- event_whenkey(key)：當指定按鍵被按下時執行。key 值：" "(空白鍵), "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w", "a", "s", "d"
- event_whenclicked：當角色被點擊時執行
- event_whencloned(body[])：當分身被產生時執行
- motion_move(steps)：沿目前方向移動
- motion_turn_right(degrees)：順時針旋轉
- motion_turn_left(degrees)：逆時針旋轉
- motion_goto_xy(x, y)：移到指定座標
- motion_point_dir(direction)：面朝方向（0上 90右 180下 270左）
- motion_change_x(dx)：水平位置改變（正右負左）
- motion_change_y(dy)：垂直位置改變（正上負下）
- motion_bounce：碰到邊緣就反彈
- looks_say(text)：顯示對話泡泡
- looks_say_for(text, seconds)：說指定秒數後消失
- looks_show：顯示角色
- looks_hide：隱藏角色
- looks_set_size(size)：設定大小百分比
- looks_costume(costume)：換成指定 emoji 造型
- sound_play(sound)：播放音效。sound 值：pop, jump, coin, laser, ding, boom
- sound_tts(text)：唸出文字（不等待）
- sound_tts_wait(text)：唸出文字（等待唸完）
- control_wait(seconds)：等待指定秒數
- control_repeat(times, body[])：重複 N 次
- control_forever(body[])：重複無限次直到停止
- control_stop：停止所有角色
- control_clone：產生自己的分身
- control_delete_clone：刪除這個分身
- sensing_touching(sprite)：是否碰到指定角色
- sensing_touching_edge：是否碰到邊緣
- sensing_keydown(key)：指定按鍵是否按住
`.trim();

const SYSTEM_PROMPT = `你是「積木遊戲工坊」的 AI 助手。用戶會用中文描述想讓角色做什麼，你要回傳對應的積木指令 JSON。

${BLOCK_REFERENCE}

回傳格式：純 JSON 陣列（不要 markdown 圍欄），每個元素是一個積木指令物件。
事件積木和控制積木用 body 陣列包含子指令。

範例 1 —「讓貓咪走正方形」：
[{"type":"event_whenflag","body":[{"type":"control_repeat","times":4,"body":[{"type":"motion_move","steps":100},{"type":"motion_turn_right","degrees":90}]}]}]

範例 2 —「按空白鍵時跳起來再落下」：
[{"type":"event_whenkey","key":" ","body":[{"type":"motion_change_y","dy":50},{"type":"control_wait","seconds":0.3},{"type":"motion_change_y","dy":-50}]}]

範例 3 —「不斷移動並碰到邊緣就反彈」：
[{"type":"event_whenflag","body":[{"type":"control_forever","body":[{"type":"motion_move","steps":5},{"type":"motion_bounce"}]}]}]

如果用戶的請求需要多個角色（例如「做一個射擊遊戲」），用多角色格式回傳：
{"sprites":[{"name":"角色名","costume":"emoji","x":0,"y":0,"blocks":[...]},...]}

規則：
- 只回傳 JSON，不要任何解釋文字
- 簡單請求回傳純陣列（單角色），複雜遊戲回傳 sprites 物件（多角色）
- body 內的指令按執行順序排列
- 事件積木只能在最外層（不能嵌套在其他積木 body 裡）`;

/** POST /api/ai/blocks */
router.post('/', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt?.trim()) return res.status(400).json({ error: '請輸入指令' });

  const apiKey = process.env.AI_API_KEY;
  const baseUrl = process.env.AI_BASE_URL || 'https://ai.zeabur.com/v1';
  const model = process.env.AI_MODEL || 'gpt-4o-mini';

  if (!apiKey) return res.status(500).json({ error: 'AI 尚未設定（缺少 AI_API_KEY）' });

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('AI API 錯誤：', response.status, err);
      return res.status(500).json({ error: 'AI 暫時忙不過來，請稍後再試' });
    }

    const result = await response.json();
    let content = result.choices?.[0]?.message?.content?.trim();
    if (!content) return res.status(500).json({ error: 'AI 沒有回應' });

    // 去掉 markdown 圍欄（AI 有時會加）
    content = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

    const parsed = JSON.parse(content);

    // 判斷格式：陣列 → 單角色 DSL；物件含 sprites → 多角色
    if (Array.isArray(parsed)) {
      res.json({ dsl: parsed });
    } else if (parsed.sprites) {
      res.json({ sprites: parsed.sprites });
    } else {
      res.json({ dsl: [parsed] });
    }
  } catch (err) {
    console.error('AI 處理錯誤：', err);
    res.status(500).json({ error: 'AI 回傳格式無法解析，請換個說法再試' });
  }
});

module.exports = router;
```

- [ ] **Step 5: 在 server/index.js 掛載 AI 路由**

在 `server/index.js` 的 `app.use('/api/projects', projectsRouter);` 之後加入：

```js
const aiRouter = require('./routes/ai');
app.use('/api/ai/blocks', aiRouter);
```

- [ ] **Step 6: 建立 js/ai-input.js — DSL 轉 Blockly 核心函式**

```js
/**
 * ai-input.js — AI 自然語言生積木：DSL→Blockly 轉換、UI 面板、語音輸入
 */
const AIInput = (() => {
  'use strict';

  /**
   * 把單一 DSL 指令轉為 Blockly serialization 格式的 block 物件
   * @param {Object} cmd DSL 指令（如 {type: "motion_move", steps: 10}）
   * @returns {Object} Blockly block JSON
   */
  function cmdToBlock(cmd) {
    const block = { type: cmd.type };

    // 數值輸入對應表：DSL 參數名 → Blockly input name
    const numInputs = {
      steps: 'STEPS', degrees: 'DEG', x: 'X', y: 'Y', direction: 'DIR',
      dx: 'DX', dy: 'DY', size: 'SIZE', seconds: 'SECS', times: 'TIMES',
    };
    // 文字輸入對應表
    const textInputs = { text: 'TEXT' };
    // 下拉欄位對應表
    const fieldMap = {
      key: 'KEY', costume: 'COSTUME', sound: 'SOUND', sprite: 'SPRITE',
    };

    const inputs = {};
    const fields = {};

    for (const [dslKey, blockInput] of Object.entries(numInputs)) {
      if (cmd[dslKey] !== undefined) {
        inputs[blockInput] = {
          shadow: { type: 'math_number', fields: { NUM: Number(cmd[dslKey]) } },
        };
      }
    }
    for (const [dslKey, blockInput] of Object.entries(textInputs)) {
      if (cmd[dslKey] !== undefined) {
        inputs[blockInput] = {
          shadow: { type: 'text', fields: { TEXT: String(cmd[dslKey]) } },
        };
      }
    }
    for (const [dslKey, fieldName] of Object.entries(fieldMap)) {
      if (cmd[dslKey] !== undefined) {
        fields[fieldName] = String(cmd[dslKey]);
      }
    }

    // looks_say_for 同時有 text 和 seconds
    // motion_goto_xy 同時有 x 和 y — 已由上面的迴圈處理

    if (Object.keys(inputs).length) block.inputs = inputs;
    if (Object.keys(fields).length) block.fields = fields;

    // body → statement input "DO"
    if (Array.isArray(cmd.body) && cmd.body.length > 0) {
      if (!block.inputs) block.inputs = {};
      block.inputs.DO = { block: chainBlocks(cmd.body) };
    }

    return block;
  }

  /**
   * 把 DSL 指令陣列串成 Blockly 的 next 鏈（statement 積木序列）
   * @param {Array} cmds DSL 指令陣列
   * @returns {Object} 第一個 block（含 next 鏈）
   */
  function chainBlocks(cmds) {
    if (!cmds.length) return undefined;
    const blocks = cmds.map(cmdToBlock);
    for (let i = 0; i < blocks.length - 1; i++) {
      blocks[i].next = { block: blocks[i + 1] };
    }
    return blocks[0];
  }

  /**
   * 把 DSL 陣列轉成完整的 Blockly workspace JSON
   * 事件積木（event_*）各自成為一棵頂層 block tree；
   * 非事件積木串成一條 statement chain 放在最頂層。
   * @param {Array} dslArray DSL 指令陣列
   * @returns {Object} Blockly workspace serialization JSON
   */
  function dslToWorkspace(dslArray) {
    const topBlocks = [];
    let yOffset = 20;

    for (const cmd of dslArray) {
      const block = cmdToBlock(cmd);
      block.x = 20;
      block.y = yOffset;
      topBlocks.push(block);
      yOffset += 120;
    }

    return { blocks: { languageVersion: 0, blocks: topBlocks } };
  }

  /**
   * 把 DSL 載入到目前選取角色的工作區（追加模式）
   * @param {Array} dslArray DSL 指令陣列
   * @returns {number} 新增的積木數量
   */
  function loadDslToWorkspace(dslArray) {
    const ws = Blockly.getMainWorkspace();
    if (!ws || !dslArray?.length) return 0;

    const state = dslToWorkspace(dslArray);
    const tempWs = new Blockly.Workspace();
    try {
      Blockly.serialization.workspaces.load(state, tempWs);
      const blockCount = tempWs.getAllBlocks(false).length;

      // 追加到主工作區：用 XML 複製每棵頂層 block tree
      const topBlocks = tempWs.getTopBlocks(true);
      const existingBlocks = ws.getTopBlocks(true);
      const startY = existingBlocks.length ? Math.max(...existingBlocks.map(b => {
        const xy = b.getRelativeToSurfaceXY();
        return xy.y + b.getHeightWidth().height;
      })) + 30 : 20;

      for (let i = 0; i < topBlocks.length; i++) {
        const blockState = Blockly.serialization.blocks.save(topBlocks[i]);
        blockState.x = 20;
        blockState.y = startY + i * 120;
        Blockly.serialization.blocks.append(blockState, ws);
      }

      return blockCount;
    } finally {
      tempWs.dispose();
    }
  }

  /* ── UI 面板 ── */

  /** 建立 AI 輸入面板 DOM */
  function buildPanel() {
    if (document.getElementById('aiPanel')) return;

    const panel = document.createElement('div');
    panel.id = 'aiPanel';
    panel.style.display = 'none';
    panel.innerHTML = `
      <div class="ai-panel-inner">
        <div class="ai-panel-header">🤖 AI 助手<button id="aiPanelClose">✕</button></div>
        <div class="ai-panel-body">
          <input type="text" id="aiPrompt" placeholder="試試看：讓貓咪走正方形" autocomplete="off">
          <div class="ai-panel-btns">
            <button id="aiMic" title="語音輸入">🎤</button>
            <button id="aiSend">送出</button>
          </div>
          <div id="aiLoading" style="display:none">⏳ AI 思考中...</div>
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    // 語音辨識不支援時隱藏麥克風按鈕
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      document.getElementById('aiMic').style.display = 'none';
    }

    document.getElementById('aiPanelClose').addEventListener('click', togglePanel);
    document.getElementById('aiSend').addEventListener('click', sendPrompt);
    document.getElementById('aiPrompt').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendPrompt();
    });
    document.getElementById('aiMic').addEventListener('click', startVoice);
  }

  /** 切換面板顯示 */
  function togglePanel() {
    const panel = document.getElementById('aiPanel');
    if (!panel) return;
    const show = panel.style.display === 'none';
    panel.style.display = show ? 'block' : 'none';
    if (show) document.getElementById('aiPrompt').focus();
  }

  /** 送出 AI 請求 */
  async function sendPrompt() {
    const input = document.getElementById('aiPrompt');
    const prompt = input.value.trim();
    if (!prompt) return;

    const loading = document.getElementById('aiLoading');
    const sendBtn = document.getElementById('aiSend');
    loading.style.display = 'block';
    sendBtn.disabled = true;

    try {
      const res = await fetch('/api/ai/blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();

      if (!res.ok) {
        showToast(data.error || 'AI 請求失敗');
        return;
      }

      if (data.sprites) {
        // 多角色模式
        handleMultiSprite(data.sprites);
      } else if (data.dsl) {
        // 單角色模式：追加到目前角色
        const count = loadDslToWorkspace(data.dsl);
        showToast(`已加入 ${count} 個積木`);
      }

      input.value = '';
    } catch (err) {
      console.error('AI 請求錯誤：', err);
      showToast('AI 連線失敗，請確認 server 是否啟動');
    } finally {
      loading.style.display = 'none';
      sendBtn.disabled = false;
    }
  }

  /** 多角色 AI 生成處理 */
  function handleMultiSprite(sprites) {
    if (!confirm(`AI 要建立 ${sprites.length} 個角色，會清除目前的作品。確定嗎？`)) return;

    // 清除現有角色（保留第一個，因為 setProject 需要至少一個）
    const project = { name: App.project.name, sprites: [] };
    for (const s of sprites) {
      const sp = App.addSpriteQuick(s.costume || '⭐', s.name || '角色');
      if (s.x !== undefined) sp.x = s.x;
      if (s.y !== undefined) sp.y = s.y;
      if (s.visible === false) sp.visible = false;
      if (Array.isArray(s.blocks) && s.blocks.length) {
        const wsState = dslToWorkspace(s.blocks);
        App.setSpriteWorkspace(sp.id, wsState);
      }
    }
    showToast(`已建立 ${sprites.length} 個角色`);
  }

  /** 語音輸入 */
  function startVoice() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-TW';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    const micBtn = document.getElementById('aiMic');
    micBtn.textContent = '🔴';
    micBtn.disabled = true;

    recognition.onresult = (e) => {
      const text = e.results[0][0].transcript;
      document.getElementById('aiPrompt').value = text;
      micBtn.textContent = '🎤';
      micBtn.disabled = false;
    };
    recognition.onerror = () => {
      showToast('沒聽清楚，再說一次試試');
      micBtn.textContent = '🎤';
      micBtn.disabled = false;
    };
    recognition.onend = () => {
      micBtn.textContent = '🎤';
      micBtn.disabled = false;
    };

    recognition.start();
  }

  /** 顯示 toast（借用 app.js 的 toast 元素） */
  function showToast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2600);
  }

  /** 初始化（app.js init 時呼叫） */
  function setup() {
    buildPanel();
  }

  return { setup, togglePanel, dslToWorkspace, loadDslToWorkspace };
})();
window.AIInput = AIInput;
```

- [ ] **Step 7: 在 index.html 加入 AI 按鈕和樣式**

在 `index.html` 的 header 裡，`btnTutorial` 按鈕之後加入：

```html
    <button id="btnAI" title="用 AI 生成積木">🤖 AI</button>
```

在 `<style>` 裡加入 AI 面板樣式（放在 `dialog#openDialog` 之前）：

```css
  /* ── AI 輸入面板 ── */
  #aiPanel {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    z-index: 2500; width: min(420px, 92vw);
  }
  .ai-panel-inner {
    background: #fff; border-radius: 16px; box-shadow: 0 8px 30px rgba(0,0,0,.3);
    border: 2px solid #4c97ff; overflow: hidden;
  }
  .ai-panel-header {
    background: #4c97ff; color: #fff; padding: 10px 16px; font-size: 16px; font-weight: bold;
    display: flex; justify-content: space-between; align-items: center;
  }
  .ai-panel-header button { background: none; border: none; color: #fff; font-size: 18px; cursor: pointer; }
  .ai-panel-body { padding: 16px; }
  #aiPrompt {
    width: 100%; padding: 10px 12px; border: 2px solid #dde; border-radius: 8px;
    font-size: 15px; margin-bottom: 10px;
  }
  .ai-panel-btns { display: flex; gap: 8px; }
  #aiMic {
    width: 44px; height: 44px; border: none; border-radius: 10px;
    background: #f0f0f0; font-size: 20px; cursor: pointer;
  }
  #aiSend {
    flex: 1; padding: 10px; border: none; border-radius: 10px;
    background: #4c97ff; color: #fff; font-size: 16px; font-weight: bold; cursor: pointer;
  }
  #aiSend:disabled { background: #aac; cursor: not-allowed; }
  #aiLoading { text-align: center; padding: 8px; color: #888; font-size: 14px; }
```

- [ ] **Step 8: 在 index.html 載入 ai-input.js 並綁定按鈕**

在 `index.html` 的 `<script src="js/app.js"></script>` 之前加入：

```html
  <script src="js/ai-input.js"></script>
```

在 `js/app.js` 的 `bindToolbar()` 函式裡加入：

```js
    $('btnAI').addEventListener('click', () => AIInput.togglePanel());
```

在 `init()` 函式裡 `Mobile.setup();` 之後加入：

```js
    AIInput.setup();
```

- [ ] **Step 9: 手動測試完整流程**

1. 啟動 server：`npm start`
2. 開啟 `http://localhost:3000`
3. 點 🤖 AI → 輸入「讓貓咪走正方形」→ 送出 → 應看到積木出現在工作區
4. 點 ▶ 執行 → 貓咪應走出正方形
5. 點 🔗 分享 → 複製連結 → 在新分頁開啟 → 應進入播放模式
6. 測試語音（如果瀏覽器支援）：點 🎤 → 說一句話 → 文字應出現在輸入框

- [ ] **Step 10: Commit**

```bash
git add js/storage.js js/app.js js/ai-input.js server/routes/ai.js server/index.js index.html
git commit -m "feat: AI 自然語言生積木 + 後端分享連結"
```

---

### Task 5: 多角色 AI 生成完善

**Files:**
- Modify: `js/ai-input.js`（完善 handleMultiSprite 邏輯）
- Modify: `js/app.js`（暴露 clearProject 給 AI 用）

- [ ] **Step 1: 在 app.js 暴露 clearAndSetProject 函式**

在 `js/app.js` 的 `removeSprite` 之後加入：

```js
  /** 清除作品並設定新的角色陣列（AI 多角色生成用） */
  function clearAndSetProject(name, sprites) {
    stopRun();
    project = { name: name || '我的遊戲', sprites };
    $('projectName').value = project.name;
    selectSprite(project.sprites[0]?.id ?? null);
    renderSpriteList();
    scheduleAutosave();
  }
```

並在 return 裡加入：

```js
  return {
    spriteOptions, run, stopRun,
    addSpriteQuick, setSpriteWorkspace, clearAndSetProject,
    get project() { return project; },
    get runtime() { return currentRuntime; },
  };
```

- [ ] **Step 2: 完善 ai-input.js 的 handleMultiSprite**

替換 `js/ai-input.js` 中的 `handleMultiSprite` 函式：

```js
  /** 多角色 AI 生成處理 */
  function handleMultiSprite(sprites) {
    if (!sprites?.length) { showToast('AI 沒有產生任何角色'); return; }
    if (!confirm(`AI 要建立 ${sprites.length} 個角色的遊戲，會取代目前的作品。確定嗎？`)) return;

    // 建立新角色陣列
    const newSprites = [];
    for (const s of sprites) {
      const costume = s.costume || '⭐';
      const name = s.name || `角色${newSprites.length + 1}`;
      const sp = {
        id: 's' + Math.random().toString(36).slice(2, 9),
        name, costume,
        x: s.x ?? 0, y: s.y ?? 0,
        dir: s.dir ?? 90, size: s.size ?? 100,
        visible: s.visible !== false,
        workspace: null,
      };
      if (Array.isArray(s.blocks) && s.blocks.length) {
        sp.workspace = dslToWorkspace(s.blocks);
      }
      newSprites.push(sp);
    }

    App.clearAndSetProject(App.project.name, newSprites);
    showToast(`已建立 ${newSprites.length} 個角色的遊戲`);
  }
```

- [ ] **Step 3: 手動測試多角色生成**

1. 開啟 `http://localhost:3000`
2. 點 🤖 AI → 輸入「做一個接蘋果的遊戲」→ 送出
3. 應該看到 AI 建立多個角色（籃子、蘋果等），各自有積木程式
4. 按 ▶ 執行 → 應該有基本的遊戲互動

- [ ] **Step 4: Commit**

```bash
git add js/ai-input.js js/app.js
git commit -m "feat: 多角色 AI 生成（支援一次建立整組遊戲角色）"
```

---

### Task 6: 帥氣模式（Canvas 特效渲染）

**Files:**
- Create: `js/fancy.js`（帥氣渲染器，獨立檔案避免 engine.js 膨脹）
- Modify: `js/engine.js`（Stage.render 加入帥氣模式分流、Runtime 加效果回呼）
- Modify: `js/app.js`（帥氣模式 toggle 按鈕、renderLoop 傳入 fancyMode 旗標）
- Modify: `index.html`（新增 toggle 按鈕 + 載入 fancy.js）

- [ ] **Step 1: 建立 js/fancy.js — 帥氣渲染器**

```js
/**
 * fancy.js — 帥氣模式渲染器
 *
 * 執行時為舞台加入 2.5D 特效：漸層天空、透視地板、角色光暈陰影、
 * 移動殘影、碰撞閃光、得分飛字、分身爆裂粒子。
 * 所有狀態掛在 FancyRenderer 實例上，不污染 Stage 或 Runtime。
 */
const FancyRenderer = (() => {
  'use strict';

  /** 浮塵粒子上限 */
  const DUST_COUNT = 18;
  /** 殘影最大保留幀數 */
  const TRAIL_MAX = 5;

  /**
   * 建立帥氣渲染器實例
   * @param {HTMLCanvasElement} canvas
   */
  function create(canvas) {
    const ctx = canvas.getContext('2d');

    /** 浮塵粒子陣列 */
    const dust = Array.from({ length: DUST_COUNT }, () => ({
      x: Math.random() * STAGE_W,
      y: Math.random() * STAGE_H,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.2,
      r: 1 + Math.random() * 2,
      alpha: 0.1 + Math.random() * 0.15,
    }));

    /** 效果佇列（飛字、閃光、粒子爆裂） */
    const effects = [];

    /** 殘影追蹤（spriteId → [{x, y, dir, costume, size}]） */
    const trails = new Map();

    /** 上一幀的變數快照（偵測變數增加產生飛字） */
    let prevVars = {};

    /* ── 背景繪製 ── */

    /** 漸層天空 */
    function drawSky() {
      const grad = ctx.createLinearGradient(0, 0, 0, STAGE_H);
      grad.addColorStop(0, '#0b1a3e');
      grad.addColorStop(0.5, '#1a3a6e');
      grad.addColorStop(1, '#2a5a9e');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, STAGE_W, STAGE_H);
    }

    /** 透視網格地板 */
    function drawGrid() {
      const horizon = STAGE_H * 0.55;
      ctx.save();
      ctx.strokeStyle = 'rgba(100, 180, 255, 0.12)';
      ctx.lineWidth = 1;

      // 水平線（間距由下往上遞減模擬透視）
      for (let i = 0; i < 12; i++) {
        const t = i / 12;
        const y = horizon + (STAGE_H - horizon) * (t * t);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(STAGE_W, y);
        ctx.stroke();
      }
      // 垂直線（從中心向外發散）
      const cx = STAGE_W / 2;
      for (let i = -6; i <= 6; i++) {
        const topX = cx + i * 12;
        const botX = cx + i * 50;
        ctx.beginPath();
        ctx.moveTo(topX, horizon);
        ctx.lineTo(botX, STAGE_H);
        ctx.stroke();
      }
      ctx.restore();
    }

    /** 更新並繪製浮塵粒子 */
    function drawDust() {
      ctx.save();
      for (const p of dust) {
        p.x += p.vx;
        p.y += p.vy + Math.sin(p.x * 0.01) * 0.1;
        if (p.x < 0) p.x = STAGE_W;
        if (p.x > STAGE_W) p.x = 0;
        if (p.y < 0) p.y = STAGE_H;
        if (p.y > STAGE_H) p.y = 0;

        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = '#aaccff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    /* ── 角色繪製 ── */

    /** 繪製帥氣版角色（陰影 + 光暈 + 放大 emoji） */
    function drawFancySprite(s, toPx) {
      if (!s.visible) return;
      const [px, py] = toPx(s.x, s.y);
      const fontSize = SPRITE_BASE_SIZE * (s.size / 100) * 1.2;
      const half = fontSize / 2;

      // 投射陰影（腳下扁橢圓）
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(px, py + half + 4, half * 0.7, half * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // 外發光暈
      ctx.save();
      ctx.shadowColor = '#4c97ff';
      ctx.shadowBlur = 18;
      ctx.translate(px, py);
      ctx.rotate((s.dir - 90) * Math.PI / 180);
      ctx.font = `${fontSize}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(s.costume, 0, 0);
      ctx.restore();

      // 對話泡泡（升級版）
      if (s.sayText) drawFancyBubble(px, py - half - 12, s.sayText);
    }

    /** 升級版對話泡泡（漸層 + 投影） */
    function drawFancyBubble(px, py, text) {
      ctx.save();
      ctx.font = 'bold 14px sans-serif';
      const w = Math.min(200, ctx.measureText(text).width + 22);
      const h = 30;
      const bx = clamp(px - w / 2, 2, STAGE_W - w - 2);
      const by = Math.max(2, py - h - 8);

      // 投影
      ctx.shadowColor = 'rgba(0,0,0,0.2)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 3;

      // 漸層背景
      const grad = ctx.createLinearGradient(bx, by, bx, by + h);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(1, '#e8f0ff');
      ctx.fillStyle = grad;
      roundRect(ctx, bx, by, w, h, 10);
      ctx.fill();

      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = '#88aadd';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // 小尾巴
      ctx.beginPath();
      ctx.moveTo(px - 5, by + h);
      ctx.lineTo(px + 5, by + h);
      ctx.lineTo(px, by + h + 8);
      ctx.closePath();
      ctx.fillStyle = '#e8f0ff';
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#1a2a4a';
      ctx.fillText(text, bx + 11, by + 20, w - 22);
      ctx.restore();
    }

    /* ── 殘影 ── */

    /** 記錄角色位置並繪製殘影 */
    function drawTrails(sprites, toPx) {
      for (const s of sprites) {
        if (!s.visible) continue;
        const key = s.id + (s.isClone ? '_c' + sprites.indexOf(s) : '');
        if (!trails.has(key)) trails.set(key, []);
        const trail = trails.get(key);
        const last = trail[trail.length - 1];

        // 只在角色移動時記錄
        if (!last || Math.abs(last.x - s.x) > 0.5 || Math.abs(last.y - s.y) > 0.5) {
          trail.push({ x: s.x, y: s.y, dir: s.dir, costume: s.costume, size: s.size });
          if (trail.length > TRAIL_MAX) trail.shift();
        }

        // 繪製殘影
        if (trail.length > 1) {
          ctx.save();
          for (let i = 0; i < trail.length - 1; i++) {
            const t = trail[i];
            const alpha = (i + 1) / (trail.length + 1) * 0.3;
            ctx.globalAlpha = alpha;
            const [tpx, tpy] = toPx(t.x, t.y);
            const fs = SPRITE_BASE_SIZE * (t.size / 100) * 1.2;
            ctx.save();
            ctx.translate(tpx, tpy);
            ctx.rotate((t.dir - 90) * Math.PI / 180);
            ctx.font = `${fs}px serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(t.costume, 0, 0);
            ctx.restore();
          }
          ctx.restore();
        }
      }
    }

    /* ── 動態效果 ── */

    /** 新增效果到佇列 */
    function addEffect(effect) {
      effects.push({ ...effect, frame: 0 });
    }

    /** 偵測變數變化產生飛字效果 */
    function detectScoreChanges(vars) {
      for (const [name, val] of Object.entries(vars || {})) {
        const prev = prevVars[name];
        if (prev !== undefined && typeof val === 'number' && typeof prev === 'number' && val > prev) {
          addEffect({ type: 'scorePopup', x: 60, y: 20, text: `+${val - prev}`, maxFrame: 40 });
        }
      }
      prevVars = { ...vars };
    }

    /** 繪製並更新所有效果 */
    function drawEffects() {
      for (let i = effects.length - 1; i >= 0; i--) {
        const e = effects[i];
        e.frame++;
        if (e.frame > e.maxFrame) { effects.splice(i, 1); continue; }

        const progress = e.frame / e.maxFrame;

        if (e.type === 'scorePopup') {
          ctx.save();
          ctx.globalAlpha = 1 - progress;
          ctx.fillStyle = '#ffdd00';
          ctx.font = 'bold 20px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(e.text, e.x, e.y - progress * 30);
          ctx.restore();
        } else if (e.type === 'cloneBurst') {
          ctx.save();
          for (const p of e.particles) {
            ctx.globalAlpha = (1 - progress) * 0.7;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(
              e.x + p.vx * e.frame * 2,
              e.y + p.vy * e.frame * 2,
              3 * (1 - progress), 0, Math.PI * 2
            );
            ctx.fill();
          }
          ctx.restore();
        } else if (e.type === 'collisionFlash') {
          ctx.save();
          ctx.globalAlpha = (1 - progress) * 0.8;
          const r = 15 + progress * 20;
          const grad = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r);
          grad.addColorStop(0, '#ffffff');
          grad.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
    }

    /** 繪製帥氣模式變數顯示 */
    function drawFancyVars(vars) {
      let vy = 10;
      ctx.save();
      for (const [name, val] of Object.entries(vars || {})) {
        const label = `${name}：${val}`;
        ctx.font = 'bold 13px sans-serif';
        const w = ctx.measureText(label).width + 20;

        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = 6;
        const grad = ctx.createLinearGradient(8, vy, 8, vy + 24);
        grad.addColorStop(0, '#ff9933');
        grad.addColorStop(1, '#ff6600');
        ctx.fillStyle = grad;
        roundRect(ctx, 8, vy, w, 24, 8);
        ctx.fill();

        ctx.shadowColor = 'transparent';
        ctx.fillStyle = '#fff';
        ctx.fillText(label, 18, vy + 17);
        vy += 30;
      }
      ctx.restore();
    }

    /* ── 主繪製函式 ── */

    /** 帥氣模式完整一幀 */
    function render(sprites, vars, toPx) {
      ctx.clearRect(0, 0, STAGE_W, STAGE_H);
      drawSky();
      drawGrid();
      drawDust();
      drawTrails(sprites, toPx);
      for (const s of sprites) drawFancySprite(s, toPx);
      detectScoreChanges(vars);
      drawFancyVars(vars);
      drawEffects();
    }

    /** 重設狀態（新一輪執行時） */
    function reset() {
      effects.length = 0;
      trails.clear();
      prevVars = {};
    }

    return { render, addEffect, reset };
  }

  return { create };
})();
```

- [ ] **Step 2: 修改 engine.js 的 Stage 類別支援帥氣模式分流**

在 `js/engine.js` 的 `Stage` 建構子裡加入 fancy 渲染器和 fancyMode 旗標：

```js
class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.fancy = FancyRenderer.create(canvas);
    this.fancyMode = false;
  }
```

修改 `Stage.render` 方法，加入帥氣模式分流：

```js
  render(sprites, vars, selectedId) {
    if (this.fancyMode && !selectedId) {
      this.fancy.render(sprites, vars, this.toPx.bind(this));
      return;
    }

    // 原有渲染邏輯（完整保留，不動）
    const ctx = this.ctx;
    ctx.clearRect(0, 0, STAGE_W, STAGE_H);
    // ... 原有程式碼不變 ...
```

`selectedId` 為 null 代表執行中或播放模式，此時走帥氣渲染；編輯模式（selectedId 有值）永遠走原版。

- [ ] **Step 3: 在 Runtime 加入效果回呼掛鉤**

在 `js/engine.js` 的 `Runtime` 建構子加入：

```js
    this.onEffect = null; // stage 設定的效果回呼
```

在 `createClone` 方法最後加入分身爆裂效果通知：

```js
    // 通知舞台產生分身爆裂效果
    if (this.onEffect) {
      this.onEffect({
        type: 'cloneBurst', x: sprite.x, y: sprite.y, maxFrame: 20,
        particles: Array.from({ length: 6 }, () => ({
          vx: (Math.random() - 0.5) * 4,
          vy: (Math.random() - 0.5) * 4,
          color: ['#ff6', '#6cf', '#f6f', '#6f6'][Math.floor(Math.random() * 4)],
        })),
      });
    }
```

- [ ] **Step 4: 修改 app.js 加入帥氣模式 toggle 和效果掛鉤**

在 `js/app.js` 的應用狀態區加入：

```js
  let fancyMode = localStorage.getItem('scratchy.fancyMode') !== 'false'; // 預設開啟
```

在 `bindToolbar()` 裡加入：

```js
    const fancyBtn = $('btnFancy');
    function updateFancyBtn() {
      fancyBtn.classList.toggle('active', fancyMode);
      fancyBtn.title = fancyMode ? '帥氣模式：開啟' : '帥氣模式：關閉';
    }
    fancyBtn.addEventListener('click', () => {
      fancyMode = !fancyMode;
      localStorage.setItem('scratchy.fancyMode', fancyMode);
      stage.fancyMode = fancyMode;
      updateFancyBtn();
    });
    updateFancyBtn();
    stage.fancyMode = fancyMode;
```

在 `run()` 函式裡 `currentRuntime = runtime;` 之後加入：

```js
    stage.fancy.reset();
    runtime.onEffect = (e) => {
      const [px, py] = stage.toPx(e.x, e.y);
      stage.fancy.addEffect({ ...e, x: px, y: py });
    };
```

- [ ] **Step 5: 在 index.html 加入帥氣模式按鈕和載入 fancy.js**

在 header 裡 `btnAI` 之後加入：

```html
    <button id="btnFancy" title="帥氣模式">✨ 帥氣</button>
```

在帥氣按鈕的 CSS（放在 AI 面板之前）：

```css
  #btnFancy.active { background: rgba(255,255,255,.45); }
```

在 `<script src="js/engine.js"></script>` 之後載入 fancy.js：

```html
  <script src="js/fancy.js"></script>
```

確保 `fancy.js` 在 `engine.js` 之後載入（依賴 `STAGE_W`、`STAGE_H`、`SPRITE_BASE_SIZE`、`roundRect` 等全域）。

- [ ] **Step 6: 手動測試帥氣模式**

1. 開啟頁面 → 點「✨ 帥氣」按鈕切換開/關
2. 編輯模式 → 畫面應始終保持原始 emoji 風格（不受帥氣模式影響）
3. 按 ▶ 執行 → 帥氣模式開啟時：
   - 背景應為深藍漸層 + 透視網格
   - 角色有光暈和腳下陰影
   - 移動時有殘影
   - 浮塵粒子緩慢飄動
4. 如果有變數加分 → 應出現飛字 `+N` 往上飄
5. 如果有分身 → 產生時應有粒子爆裂效果
6. 帥氣模式關閉 → 執行時畫面回到原始白底 emoji
7. 重新整理 → 帥氣模式狀態應保持（localStorage）

- [ ] **Step 7: Commit**

```bash
git add js/fancy.js js/engine.js js/app.js index.html
git commit -m "feat: 帥氣模式（2.5D 特效：漸層天空、透視地板、光暈殘影、飛字粒子）"
```

---

### Task 7: 最終整合測試與清理

**Files:**
- Modify: `package.json`（確認所有依賴）
- Review: 所有檔案（跨功能整合驗證）

- [ ] **Step 1: 全功能整合測試**

啟動 server 後逐項驗證：

1. **觸控拖拉**：Chrome DevTools 手機模式 → 觸碰拖曳角色 → 應順暢移動
2. **Clone 分身**：積木「產生自己的分身」→ 分身出現在舞台上
3. **分享**：點 🔗 → 複製連結 → 新分頁開啟 → 進入播放模式可正常玩
4. **AI 單角色**：🤖 AI →「讓貓咪走正方形」→ 積木出現 → ▶ 可執行
5. **AI 多角色**：🤖 AI →「做一個接蘋果遊戲」→ 多角色建立 → ▶ 可執行
6. **AI 語音**：🎤 → 說中文 → 辨識結果填入 → 可送出
7. **帥氣模式**：✨ 開啟 → ▶ 執行 → 應有漸層背景、光暈、殘影
8. **帥氣 + Clone**：分身產生時應有粒子爆裂效果
9. **帥氣 + 變數**：變數增加時應有飛字效果
10. **向下相容**：舊的 `#p=...` 分享連結仍可正常開啟

- [ ] **Step 2: 確認 .gitignore 和 .env**

確認 `.gitignore` 包含：
```
node_modules/
scratchy.db
.env
```

確認 `.env` 裡有正確的範本結構（但不含真實金鑰）。

- [ ] **Step 3: Final commit**

```bash
git add -A
git status
git commit -m "chore: 六功能整合完成，清理與最終驗證"
```
