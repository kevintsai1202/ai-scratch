# 積木遊戲工坊 — 三功能擴充設計文件

日期：2026-06-13

## 概述

為現有「積木遊戲工坊」（Scratch 風格網頁遊戲製作工具）新增三項功能：

1. **觸控拖拉角色** — 手機/平板可在舞台上拖曳角色
2. **後端儲存 + 分享** — 輕量 API Server，作品存 SQLite，短連結分享
3. **AI 自然語言生積木** — 語音/文字輸入中文指令，AI 生成積木程式

## 決策摘要

| 議題 | 決定 |
|------|------|
| 觸控拖拉 | canvas 加 touch 事件，共用現有 mouse 邏輯 |
| 後端框架 | Express + better-sqlite3，部署到 Zeabur |
| 分享機制 | POST 作品 → SQLite → nanoid 短 ID → `/play/:id` |
| AI 引擎 | Zeabur AI Hub（OpenAI 相容），API key 放 `.env` 由後端代理 |
| AI 積木生成 | 中間 DSL 方案：AI 輸出簡化指令 → 前端 `dslToBlocks()` 轉 Blockly |
| 語音輸入 | 瀏覽器 Web Speech API（`webkitSpeechRecognition`），不支援時退化為純文字 |
| 向下相容 | 保留 `#p=` hash 舊分享連結解析、保留 localStorage 個人儲存 |

---

## 功能一：觸控拖拉角色

### 改動範圍

僅 `js/app.js` 的 `bindStageMouse()` 函式 + `index.html` canvas CSS。

### 做法

在 canvas 上新增 `touchstart` / `touchmove` / `touchend` 事件監聽：

- **touchstart**：取 `e.touches[0]` 座標，走跟 `mousedown` 同樣的路徑：
  - 執行中 → `hitTest(runtime.sprites)` → `fireClick(hit)`
  - 編輯中 → `hitTest(project.sprites)` → 選取角色 + 啟動拖曳
- **touchmove**：拖曳更新角色座標 + `renderProps()`，需 `e.preventDefault()` 防頁面滾動
- **touchend**：放開拖曳 + `scheduleAutosave()`

CSS 補上：
```css
canvas#stage { touch-action: none; }
```

### 注意事項

- 提取 `toCanvasXY` 輔助函式讓 mouse 和 touch 共用座標轉換
- touchstart 處理執行中 `fireClick` 讓「當角色被點擊」積木在手機上也能觸發

---

## 功能二：後端 API Server

### 檔案結構

```
server/
  index.js              — Express 入口，掛載路由 + 靜態檔案
  db.js                 — SQLite 初始化 + CRUD 函式
  routes/projects.js    — 作品儲存/讀取 API
  routes/ai.js          — AI 自然語言生積木代理
.env                    — PORT, AI_API_KEY, AI_BASE_URL, AI_MODEL
```

### 資料表

```sql
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);
```

- `id`：nanoid 產生的 7 字元短 ID（如 `aB3xK7m`）
- `data`：作品完整 JSON 字串（sprites 陣列含各角色的 workspace 序列化）

### API 端點

| 方法 | 路徑 | 說明 | 請求 | 回應 |
|------|------|------|------|------|
| POST | `/api/projects` | 儲存作品 | `{ name, sprites }` | `{ id }` |
| GET  | `/api/projects/:id` | 讀取作品 | — | `{ id, name, sprites, ... }` |
| POST | `/api/ai/blocks` | AI 生積木 | `{ prompt }` | `{ dsl: [...] }` |

### 靜態檔案服務

`server/index.js` 用 `express.static` 指向專案根目錄，serve `index.html` 及 `js/` 等前端檔案。

`/play/:id` 路由回傳同一份 `index.html`，前端 JS 偵測 URL path 來決定是否進入播放模式。

### 前端改動

**storage.js：**
- 新增 `shareToServer(project)` — `POST /api/projects` → 回傳 `{ id }`
- 新增 `loadFromServer(id)` — `GET /api/projects/:id` → 回傳作品 JSON
- 保留所有 localStorage 函式不變

**app.js：**
- `init()` 載入時新增偵測：`/play/:id` 路徑 → 呼叫 `loadFromServer(id)` → 播放模式
- 「分享」按鈕改呼叫 `shareToServer()` → 複製 `https://domain/play/<id>` 連結
- 保留 `#p=` hash 解析（向下相容）

### 部署

- Zeabur Node.js 服務，persistent volume 掛載 SQLite 檔案路徑
- `.env` 在 Zeabur 用環境變數設定

---

## 功能三：AI 自然語言生積木

### 架構

```
用戶語音/文字 → 前端 ai-input.js → POST /api/ai/blocks
                                          ↓
             前端 dslToBlocks() ← 後端回傳 DSL JSON ← Zeabur AI Hub
```

### 中間 DSL 格式

AI 回傳一個指令陣列，每個指令對應一個積木。type 名稱精確對應 `blocks.js` 定義：

```json
[
  {"type": "event_whenflag"},
  {"type": "motion_move", "steps": 10},
  {"type": "motion_turn_right", "degrees": 90},
  {"type": "looks_say", "text": "你好"},
  {"type": "control_repeat", "times": 4, "body": [
    {"type": "motion_move", "steps": 50},
    {"type": "motion_turn_right", "degrees": 90}
  ]},
  {"type": "control_forever", "body": [
    {"type": "motion_move", "steps": 5},
    {"type": "motion_bounce"}
  ]},
  {"type": "control_wait", "seconds": 1},
  {"type": "looks_say_for", "text": "哈囉", "seconds": 2},
  {"type": "looks_show"},
  {"type": "looks_hide"},
  {"type": "looks_set_size", "size": 150},
  {"type": "looks_costume", "costume": "🐶"},
  {"type": "motion_goto_xy", "x": 100, "y": -50},
  {"type": "motion_point_dir", "direction": 180},
  {"type": "motion_change_x", "dx": 10},
  {"type": "motion_change_y", "dy": -10},
  {"type": "motion_turn_left", "degrees": 45},
  {"type": "sound_play", "sound": "coin"},
  {"type": "sound_tts", "text": "遊戲開始"},
  {"type": "sensing_touching", "sprite": "貓咪"},
  {"type": "sensing_touching_edge"},
  {"type": "sensing_keydown", "key": "ArrowUp"},
  {"type": "event_whenkey", "key": " "},
  {"type": "event_whenclicked"},
  {"type": "control_stop"}
]
```

完整 type 對照表（AI prompt 會列出供模型參考）：

| DSL type | 參數 | 說明 |
|----------|------|------|
| event_whenflag | 無 | 當綠旗（執行鈕）被點擊時開始 |
| event_whenkey | key：按鍵名稱 | 當指定按鍵被按下時執行 |
| event_whenclicked | 無 | 當這個角色被滑鼠或手指點擊時執行 |
| motion_move | steps：數字 | 讓角色沿目前方向移動指定點數 |
| motion_turn_right | degrees：數字 | 讓角色順時針旋轉指定度數 |
| motion_turn_left | degrees：數字 | 讓角色逆時針旋轉指定度數 |
| motion_goto_xy | x：數字, y：數字 | 讓角色瞬間移動到指定座標位置 |
| motion_point_dir | direction：數字 | 讓角色面朝指定方向（0 朝上、90 朝右、180 朝下、270 朝左） |
| motion_change_x | dx：數字 | 讓角色的水平位置改變指定量（正數向右、負數向左） |
| motion_change_y | dy：數字 | 讓角色的垂直位置改變指定量（正數向上、負數向下） |
| motion_bounce | 無 | 碰到舞台邊緣時自動反彈改變方向 |
| looks_say | text：文字 | 讓角色顯示對話泡泡說出指定文字 |
| looks_say_for | text：文字, seconds：數字 | 讓角色說出文字並在指定秒數後自動消失 |
| looks_show | 無 | 讓角色顯示在舞台上 |
| looks_hide | 無 | 讓角色從舞台上隱藏 |
| looks_set_size | size：數字 | 設定角色的大小百分比（100 為原始大小） |
| looks_costume | costume：emoji 字元 | 把角色的造型換成指定的 emoji 表情符號 |
| sound_play | sound：音效名稱（啵=pop、跳躍=jump、金幣=coin、雷射=laser、叮=ding、爆炸=boom） | 播放一個預設音效 |
| sound_tts | text：文字 | 用語音唸出指定文字（不等唸完就繼續） |
| sound_tts_wait | text：文字 | 用語音唸出指定文字（唸完才繼續下一步） |
| control_wait | seconds：數字 | 暫停等待指定秒數後再繼續 |
| control_repeat | times：數字, body：指令陣列 | 把 body 裡的指令重複執行指定次數 |
| control_forever | body：指令陣列 | 把 body 裡的指令不斷重複執行直到停止 |
| control_stop | 無 | 停止所有角色的程式執行 |
| sensing_touching | sprite：角色名稱 | 判斷是否碰到指定名稱的其他角色 |
| sensing_touching_edge | 無 | 判斷是否碰到舞台的邊緣 |
| sensing_keydown | key：按鍵名稱 | 判斷指定按鍵是否正被按住 |

**按鍵名稱對照：** 空白鍵=`" "`、上=`"ArrowUp"`、下=`"ArrowDown"`、左=`"ArrowLeft"`、右=`"ArrowRight"`、字母鍵用小寫如 `"w"` `"a"` `"s"` `"d"`

### 後端 AI 路由（`server/routes/ai.js`）

- 接收：`POST /api/ai/blocks`，body `{ prompt: "讓貓咪走正方形" }`
- 組裝 system prompt：可用積木清單 + DSL 格式規範 + 3 個 few-shot 範例
- 呼叫 Zeabur AI Hub（OpenAI Chat Completions 相容格式）
- 解析 AI 回傳的 JSON → 回傳 `{ dsl: [...] }`
- 錯誤時回傳 `{ error: "..." }` + HTTP 500

### 前端 DSL → Blockly 轉換器

新檔 `js/ai-input.js`，核心函式 `dslToBlocks(dslArray)`：

1. 遍歷 DSL 陣列
2. 每個指令根據 type 建立對應的 Blockly block（使用 `Blockly.serialization` 格式）
3. 事件積木（event_*）的 body 放在 `DO` statement input
4. 控制積木（control_repeat、control_forever）的 body[] 遞迴轉換放在 `DO` statement input
5. 數值參數生成對應的 `math_number` shadow block
6. 文字參數生成對應的 `text` shadow block
7. 輸出完整的 Blockly workspace JSON
8. 載入到目前選取角色的工作區（追加模式，不清除現有積木）

### 前端 UI

- 工具列加「🤖 AI」按鈕
- 點擊開啟浮動面板（固定在舞台上方或底部）：
  - 文字輸入框（placeholder：「試試看：讓貓咪走正方形」）
  - 🎤 語音按鈕（僅支援的瀏覽器顯示）
  - 送出按鈕
  - loading 狀態指示
- 語音辨識完成後填入文字框，用戶可修改後再送出
- 成功後 toast 提示「已加入 N 個積木」
- 失敗後 toast 提示錯誤訊息

### 語音輸入

- 使用 `webkitSpeechRecognition` / `SpeechRecognition`
- `lang: 'zh-TW'`
- `interimResults: false`，`maxAlternatives: 1`
- 按住 🎤 開始 → 放開或 `onresult` 自動停止
- 不支援 `SpeechRecognition` 的瀏覽器：隱藏 🎤 按鈕

### `.env` 範例

```
PORT=3000
AI_API_KEY=your-zeabur-ai-hub-key
AI_BASE_URL=https://ai.zeabur.com/v1
AI_MODEL=gpt-4o-mini
```

---

## 錯誤處理

| 情境 | 處理 |
|------|------|
| 後端 SQLite 寫入失敗 | 500 + JSON error message |
| 作品 ID 不存在 | 404 + toast「找不到這個作品」|
| AI API 呼叫逾時/失敗 | 500 + toast「AI 暫時忙不過來，請稍後再試」|
| AI 回傳非法 JSON | 後端嘗試修復（去掉 markdown 圍欄），仍失敗回 500 |
| DSL 含未知 type | 前端跳過該指令 + console.warn |
| 語音辨識失敗/無結果 | toast「沒聽清楚，再說一次試試」|
| 分享網址中的作品已不存在 | toast 提示 + 回到編輯模式 |

---

## 功能四：Clone 分身積木

### 動機

射擊遊戲、彈幕、粒子特效等都需要在執行期動態產生角色。目前每個角色都是編輯時手動新增，
無法在程式中動態複製。新增 Clone 機制讓一個角色可以在執行中產生自己的「分身」。

### 新增積木（blocks.js）

| type | 類別 | 說明 |
|------|------|------|
| control_clone | 控制 | 產生自己的分身（最多 60 個，超過靜默忽略） |
| event_whencloned | 事件 | 當分身被產生時執行（C 形事件積木） |
| control_delete_clone | 控制 | 刪除這個分身（僅分身可用，本體忽略） |

### 引擎改動（engine.js）

**RuntimeSprite 新增屬性：**
- `isClone`：布林值，本體為 false、分身為 true
- `cloneParentId`：分身的來源角色 ID

**Runtime 新增方法：**
- `createClone(sprite)` — 複製 sprite 的狀態（座標、方向、大小、造型）建立分身 RuntimeSprite，加入 `this.sprites` 陣列，觸發該角色的 `event_whencloned` handler
- `deleteClone(sprite)` — 若 `sprite.isClone` 為 true，從 `this.sprites` 移除

**限制：** 每個角色最多 60 個分身（`MAX_CLONES = 60`），超過時 `createClone` 靜默忽略。整個 Runtime 總分身數上限 300。

**Stage 渲染：** 不需改動，分身只是 `runtime.sprites` 裡多出來的 RuntimeSprite，照常繪製。

### 程式碼產生器

```
control_clone    → `runtime.createClone(sprite);\n`
event_whencloned → `runtime.whenCloned(sprite, async () => {\n${body}});\n`
control_delete_clone → `runtime.deleteClone(sprite);\n`
```

### DSL 擴充

| DSL type | 參數 | 說明 |
|----------|------|------|
| control_clone | 無 | 產生自己的分身 |
| event_whencloned | body：指令陣列 | 當分身被產生時執行的程式 |
| control_delete_clone | 無 | 刪除這個分身 |

---

## 功能五：多角色 AI 生成

### 動機

「幫我建立一個垂直射擊遊戲」需要 AI 一次產生多個角色（玩家、子彈、敵人）
及各自的積木程式。原本的 DSL 只能為單一角色生成積木，需要擴充。

### 多角色 DSL 格式

原本 AI 回傳：
```json
{ "dsl": [ ...單一角色的指令陣列 ] }
```

擴充為：
```json
{
  "sprites": [
    {
      "name": "飛船",
      "costume": "🚀",
      "x": 0, "y": -140,
      "blocks": [
        {"type": "event_whenflag", "body": [
          {"type": "control_forever", "body": [
            {"type": "sensing_keydown", "key": "ArrowLeft"},
            {"type": "motion_change_x", "dx": -5}
          ]}
        ]}
      ]
    },
    {
      "name": "子彈",
      "costume": "⭐",
      "x": 0, "y": 0,
      "visible": false,
      "blocks": [
        {"type": "event_whencloned", "body": [
          {"type": "looks_show"},
          {"type": "control_forever", "body": [
            {"type": "motion_change_y", "dy": 10},
            {"type": "sensing_touching_edge"},
            {"type": "control_delete_clone"}
          ]}
        ]}
      ]
    },
    {
      "name": "敵人",
      "costume": "👾",
      "x": 0, "y": 160,
      "blocks": [...]
    }
  ]
}
```

### 前端處理流程

1. AI 回傳多角色 DSL
2. 前端逐一呼叫 `App.addSpriteQuick(costume, name)` 建立角色
3. 對每個角色呼叫 `dslToBlocks(sprite.blocks)` 轉成 Blockly workspace JSON
4. 呼叫 `App.setSpriteWorkspace(id, workspaceState)` 設定積木

### 向下相容

- 後端 AI 路由回傳格式用欄位區分：有 `sprites` 欄位 → 多角色模式；有 `dsl` 欄位 → 單角色模式
- 前端 `ai-input.js` 根據回傳格式自動判斷處理方式
- 單角色模式：指令追加到目前選取的角色
- 多角色模式：清除目前作品並建立全新角色組合（會先 confirm 確認）

### AI System Prompt 調整

- 新增 few-shot 範例：垂直射擊、接蘋果、迷宮等多角色遊戲
- 提示 AI 判斷：簡單請求（「讓貓走正方形」）→ 單角色 DSL；遊戲請求（「做一個射擊遊戲」）→ 多角色 DSL

---

## 功能六：帥氣模式（Canvas 特效渲染）

### 動機

編輯時使用簡單 emoji 方便辨識和操作，但執行遊戲時畫面過於陽春。
新增「帥氣模式」開關，執行時用 Canvas 特效讓畫面從純 emoji 提升到有 2.5D 感覺的精緻畫面。

### 切換機制

- 工具列新增「✨ 帥氣模式」toggle 按鈕（預設開啟）
- 狀態存在 localStorage `scratchy.fancyMode`
- 僅在 **執行中** 生效；編輯模式永遠用原始 emoji 簡潔呈現
- `Stage.render()` 根據 `fancyMode && running` 決定走哪套渲染邏輯

### 改動範圍

主要在 `js/engine.js` 的 `Stage` 類別內新增帥氣渲染方法。不影響積木、不影響座標系統。

### 特效清單

#### 一、舞台背景

| 效果 | 做法 |
|------|------|
| 漸層天空 | 頂部深藍 → 底部淺藍 `createLinearGradient` |
| 透視網格地板 | 下半部繪製梯形透視線條（水平線間距由下往上遞減），營造 2.5D 地板感 |
| 粒子浮塵 | 10-20 個半透明小圓點緩慢飄動（每幀微量位移 + 上下浮動），增加空間感 |

#### 二、角色增強

| 效果 | 做法 |
|------|------|
| 投射陰影 | 角色腳下繪製一個扁橢圓（`ellipse`），灰色半透明，大小跟角色 size 連動 |
| 外發光暈 | `ctx.shadowColor` + `ctx.shadowBlur` 為角色加柔和光暈，顏色依角色分類（暖色/冷色） |
| 角色放大 | 帥氣模式下 emoji 字級乘以 1.2 倍，讓角色更搶眼 |
| 對話泡泡升級 | 加圓角漸層背景 + 投影，文字加粗 |

#### 三、動態效果

| 效果 | 觸發時機 | 做法 |
|------|----------|------|
| 移動殘影 | 角色座標變化時 | 記錄最近 3-5 幀位置，以遞減透明度繪製歷史影像 |
| 碰撞閃光 | `sensing_touching` 為 true 時 | 兩角色接觸點畫一個短暫白色放射閃光（2-3 幀衰減） |
| 得分飛字 | 變數值增加時 | 在舞台上方浮出 `+N` 文字，往上飄並淡出（持續約 40 幀） |
| 分身產生爆裂 | `createClone` 時 | 在產生位置畫 5-8 個小圓粒子向外擴散並淡出 |

### 實作架構

```
Stage 類別內新增：

renderFancy(sprites, vars)     — 帥氣版主繪製函式
drawSkyGradient()               — 漸層天空
drawPerspectiveGrid()           — 透視地板
updateParticles() / drawParticles() — 浮塵粒子（狀態存在 Stage 實例上）
drawFancySprite(sprite)         — 陰影 + 光暈 + 放大 emoji
drawTrail(sprite)               — 殘影軌跡
drawCollisionFlash(s1, s2)      — 碰撞閃光
drawScorePopup(name, delta)     — 飛字
drawCloneEffect(x, y)           — 分身粒子

render() 改為：
  if (fancyMode && running) → renderFancy(...)
  else → 原有邏輯（不動）
```

### 效果佇列

動態效果（飛字、閃光、粒子）需要跨幀生命週期。在 Stage 實例上維護一個 `effects` 陣列：

```js
// { type: 'scorePopup', x, y, text, frame: 0, maxFrame: 40 }
// { type: 'cloneBurst', x, y, particles: [...], frame: 0, maxFrame: 20 }
```

每幀 `renderFancy` 遍歷 `effects`，畫出並遞增 frame，到 maxFrame 移除。
Runtime 透過回呼通知 Stage 產生新效果（例如 `stage.addEffect({...})`）。

### 殘影追蹤

Stage 維護 `trailMap: Map<spriteId, [{x, y, dir, costume}]>`，每幀記錄每個角色位置，保留最近 5 筆。繪製時從舊到新以遞增透明度畫出 emoji。角色靜止不動時不畫殘影。

### 效能考量

- 粒子數量固定上限（浮塵 20、爆裂 8）
- 殘影只保留 5 幀
- 所有特效用簡單幾何圖形（圓、橢圓、線段），不使用濾鏡或 offscreen canvas
- 帥氣模式可隨時關閉回到零開銷的原始渲染

---

## 不做的事

- 使用者帳號/登入系統（第一版不需要）
- 作品列表/探索頁（未來再加）
- AI 即時串流（先用完整回傳，延遲可接受）
- AI 編輯現有積木（第一版只追加新積木）
