/**
 * tutorial.js — 兒童互動闖關教學
 *
 * 設計：
 *   - 聚光燈（spotlight）高亮目標 UI，半透明遮罩用 box-shadow 撐滿全螢幕，
 *     pointer-events: none 讓孩子能直接操作被高亮的元件
 *   - 教學卡固定在畫面下方，每關有「過關條件」(check)，每 0.5 秒輪詢，
 *     達成才亮起「下一步」；卡關可按「✨ 幫我放積木」由系統代放
 *   - 首次開啟自動開始（播放模式與手機編輯不觸發），🎓 按鈕可隨時重來
 */
const Tutorial = (() => {
  'use strict';

  const DONE_KEY = 'scratchy.tutorialDone'; // localStorage：完成過教學的旗標
  let idx = 0;          // 目前關卡索引
  let layer = null;     // 教學圖層根節點
  let pollTimer = null; // 過關條件輪詢計時器

  /* ── 積木程式範本（✨幫手注入用；Blockly 序列化 JSON） ── */

  /** 第 1 關範本：當▶被點擊 → 移動 10 點 */
  const STATE_FLAG_MOVE = {
    blocks: { languageVersion: 0, blocks: [{
      type: 'event_whenflag', x: 30, y: 30,
      inputs: { DO: { block: {
        type: 'motion_move',
        inputs: { STEPS: { shadow: { type: 'math_number', fields: { NUM: 10 } } } },
      } } },
    }] },
  };

  /** 第 2 關範本：保留第 1 關 ＋ 左右鍵控制 */
  const STATE_KEYS = {
    blocks: { languageVersion: 0, blocks: [
      STATE_FLAG_MOVE.blocks.blocks[0],
      { type: 'event_whenkey', x: 30, y: 180, fields: { KEY: 'ArrowRight' },
        inputs: { DO: { block: {
          type: 'motion_change_x',
          inputs: { DX: { shadow: { type: 'math_number', fields: { NUM: 15 } } } },
        } } } },
      { type: 'event_whenkey', x: 30, y: 320, fields: { KEY: 'ArrowLeft' },
        inputs: { DO: { block: {
          type: 'motion_change_x',
          inputs: { DX: { shadow: { type: 'math_number', fields: { NUM: -15 } } } },
        } } } },
    ] },
  };

  /** 蘋果掉落程式範本：catName = 要碰的角色名稱 */
  function appleState(catName) {
    /** 「移到 x:隨機 y:150」積木（回到頂端重新掉落） */
    const gotoTop = () => ({
      type: 'motion_goto_xy',
      inputs: {
        X: { block: { type: 'math_random_int', inputs: {
          FROM: { shadow: { type: 'math_number', fields: { NUM: -200 } } },
          TO: { shadow: { type: 'math_number', fields: { NUM: 200 } } } } } },
        Y: { shadow: { type: 'math_number', fields: { NUM: 150 } } },
      },
    });
    return {
      variables: [{ name: '分數', id: 'tutorialScore' }],
      blocks: { languageVersion: 0, blocks: [{
        type: 'event_whenflag', x: 30, y: 30,
        inputs: { DO: { block: {
          type: 'variables_set', fields: { VAR: { id: 'tutorialScore' } },
          inputs: { VALUE: { shadow: { type: 'math_number', fields: { NUM: 0 } } } },
          next: { block: { ...gotoTop(), next: { block: {
            type: 'control_forever',
            inputs: { DO: { block: {
              type: 'motion_change_y',
              inputs: { DY: { shadow: { type: 'math_number', fields: { NUM: -4 } } } },
              next: { block: {
                type: 'controls_if',
                inputs: {
                  IF0: { block: { type: 'sensing_touching', fields: { SPRITE: catName } } },
                  DO0: { block: {
                    type: 'math_change', fields: { VAR: { id: 'tutorialScore' } },
                    inputs: { DELTA: { shadow: { type: 'math_number', fields: { NUM: 1 } } } },
                    next: { block: gotoTop() },
                  } },
                },
                next: { block: {
                  type: 'controls_if',
                  inputs: {
                    IF0: { block: { type: 'logic_compare', fields: { OP: 'LT' }, inputs: {
                      A: { block: { type: 'sensing_y' } },
                      B: { shadow: { type: 'math_number', fields: { NUM: -150 } } } } } },
                    DO0: { block: gotoTop() },
                  },
                } },
              } },
            } } },
          } } } },
        } } },
      }] },
    };
  }

  /* ── 過關條件輔助：掃描序列化 JSON 找積木 ── */

  /** 深度走訪 workspace 序列化 JSON，收集所有積木型別 */
  function collectTypes(node, out) {
    if (!node || typeof node !== 'object') return out;
    if (node.type) out.push(node.type);
    for (const v of Object.values(node)) collectTypes(v, out);
    return out;
  }

  /** 目前選取角色的工作區是否同時含有指定積木型別 */
  function workspaceHas(...types) {
    const state = Blockly.serialization.workspaces.save(Blockly.getMainWorkspace());
    const found = collectTypes(state, []);
    return types.every(t => found.includes(t));
  }

  /* ── 關卡定義 ── */

  const steps = [
    { badge: '歡迎', title: '嗨！我是積木小精靈 🧚',
      text: '歡迎來到積木遊戲工坊！跟著我闖 5 關，你就能做出第一個自己的遊戲：「貓咪接蘋果」🐱🍎 準備好了嗎？',
      nextLabel: '開始闖關！' },

    { badge: '探險 1/2', title: '這是你的積木箱 🧰', target: ['.blocklyToolboxDiv', '.blocklyToolbox'],
      text: '左邊每個顏色都是一類積木：黃色是「事件」、藍色是「動作」、紫色是「外觀」… 點一下分類就能看到裡面的積木，把它們拖到中間空地就能用！' },

    { badge: '探險 2/2', title: '這是舞台 🎭', target: ['#stageWrap'],
      text: '角色會在這個白色舞台上表演。沒在玩的時候，你可以直接用滑鼠把角色拖到喜歡的位置喔！' },

    { badge: '第 1 關', title: '讓貓咪動起來！🐱', target: ['#blocklyDiv'],
      text: '從黃色「事件」拉出「當 ▶ 被點擊」，再從藍色「動作」把「移動 10 點」放進它的肚子裡。卡住了就按下面的 ✨。',
      check: () => workspaceHas('event_whenflag', 'motion_move'),
      helper: () => loadIntoCurrent(STATE_FLAG_MOVE) },

    { badge: '第 1 關', title: '按下綠色 ▶ 試試！', target: ['#btnRun'],
      text: '按下右上角綠色的 ▶，看看貓咪有沒有往前走一步！（每按一次都會重新開始）',
      check: () => !!App.runtime && Math.abs(App.runtime.sprites[0]?.x ?? 0) > 0.5 },

    { badge: '第 2 關', title: '用鍵盤控制貓咪 ⌨️', target: ['#blocklyDiv'],
      text: '再加兩組積木：「當 → 鍵被按下」放「x 改變 15」、「當 ← 鍵被按下」放「x 改變 -15」。這樣貓咪就聽你的指揮了！',
      check: () => workspaceHas('event_whenkey', 'motion_change_x'),
      helper: () => loadIntoCurrent(STATE_KEYS) },

    { badge: '第 3 關', title: '請出蘋果！🍎', target: ['#spriteList'],
      text: '遊戲要有目標！按角色區的「＋」新增一個角色（或按 ✨ 直接變出蘋果）。',
      check: () => App.project.sprites.length >= 2,
      helper: () => App.addSpriteQuick('🍎', '蘋果') },

    { badge: '第 4 關', title: '給蘋果裝上魔法 ✨', target: ['#spriteList'],
      text: '蘋果要從天上掉下來、碰到貓咪就加分。這段比較難，按 ✨ 讓我幫蘋果放好積木，然後點蘋果角色看看它的程式長什麼樣子！',
      check: () => {
        const apple = App.project.sprites[1];
        return !!apple?.workspace && collectTypes(apple.workspace, []).includes('control_forever');
      },
      helper: () => {
        const cat = App.project.sprites[0];
        const apple = App.project.sprites[1] || App.addSpriteQuick('🍎', '蘋果');
        App.setSpriteWorkspace(apple.id, appleState(cat.name));
      } },

    { badge: '第 5 關', title: '玩你做的遊戲！🎮', target: ['#btnRun'],
      text: '按 ▶ 開始！用鍵盤 ← → 移動貓咪去接蘋果，接到一顆就加 1 分（分數在舞台左上角）。',
      check: () => !!App.runtime && '分數' in (App.runtime.vars || {}) },

    { badge: '畢業囉', title: '恭喜你，遊戲設計師！🏆🎉',
      text: '你完成了第一個遊戲！記得按 💾 儲存作品、按 🔗 把連結傳給朋友一起玩。想再看一次教學，隨時按上面的 🎓。',
      nextLabel: '完成 🎉' },
  ];

  /** ✨幫手共用：把範本載入目前工作區（會取代現有積木） */
  function loadIntoCurrent(state) {
    Blockly.serialization.workspaces.load(state, Blockly.getMainWorkspace());
  }

  /* ── UI ── */

  /** 建立教學圖層（spotlight ＋ 教學卡） */
  function buildLayer() {
    layer = document.createElement('div');
    layer.id = 'tutorialLayer';

    const spot = document.createElement('div');
    spot.id = 'tutorialSpot';
    layer.appendChild(spot);

    const card = document.createElement('div');
    card.id = 'tutorialCard';
    const badge = el('div', 'tut-badge');
    const title = el('h3', 'tut-title');
    const text = el('p', 'tut-text');
    const done = el('div', 'tut-done');
    done.textContent = '✅ 做到了！可以前進囉！';
    const btnRow = el('div', 'tut-btns');
    const btnHelp = el('button', 'tut-help');
    btnHelp.textContent = '✨ 幫我放積木';
    const btnNext = el('button', 'tut-next');
    const btnSkip = el('button', 'tut-skip');
    btnSkip.textContent = '跳過教學';
    btnRow.append(btnHelp, btnNext, btnSkip);
    card.append(badge, title, text, done, btnRow);
    layer.appendChild(card);
    document.body.appendChild(layer);

    btnNext.addEventListener('click', () => { idx + 1 >= steps.length ? finish() : show(idx + 1); });
    btnSkip.addEventListener('click', finish);
    btnHelp.addEventListener('click', () => { steps[idx].helper?.(); });
  }

  function el(tag, cls) { const n = document.createElement(tag); n.className = cls; return n; }

  /** 顯示第 i 關 */
  function show(i) {
    idx = i;
    const s = steps[i];
    const q = (sel) => layer.querySelector(sel);
    q('.tut-badge').textContent = s.badge;
    q('.tut-title').textContent = s.title;
    q('.tut-text').textContent = s.text;
    q('.tut-help').style.display = s.helper ? '' : 'none';
    q('.tut-next').textContent = s.nextLabel || '下一步 ▶';
    q('.tut-done').style.display = 'none';
    window.UIVoice?.annotate(layer); // 教學卡文字補注音
    updateSpot();
    updateCheck();
  }

  /** 更新聚光燈位置（每次輪詢也會更新，跟著版面移動） */
  function updateSpot() {
    const spot = layer.querySelector('#tutorialSpot');
    const s = steps[idx];
    let rect = null;
    for (const sel of s.target || []) {
      const node = document.querySelector(sel);
      if (node) { rect = node.getBoundingClientRect(); break; }
    }
    if (!rect) { spot.style.display = 'none'; return; }
    spot.style.display = '';
    spot.style.left = `${rect.left - 6}px`;
    spot.style.top = `${rect.top - 6}px`;
    spot.style.width = `${rect.width + 12}px`;
    spot.style.height = `${rect.height + 12}px`;
  }

  /** 輪詢過關條件：沒過 → 下一步變灰；過了 → 亮起並顯示鼓勵 */
  function updateCheck() {
    clearInterval(pollTimer);
    const s = steps[idx];
    const btnNext = layer.querySelector('.tut-next');
    const tick = () => {
      updateSpot();
      let ok = true;
      try { ok = s.check ? !!s.check() : true; } catch { ok = false; }
      btnNext.disabled = !ok;
      layer.querySelector('.tut-done').style.display = (ok && s.check) ? '' : 'none';
    };
    tick();
    pollTimer = setInterval(tick, 500);
  }

  /** 結束教學（完成或跳過都記為已看過） */
  function finish() {
    clearInterval(pollTimer);
    layer?.remove();
    layer = null;
    localStorage.setItem(DONE_KEY, '1');
  }

  /** 開始教學（🎓 按鈕／首次開啟） */
  function start() {
    if (layer) return;
    buildLayer();
    show(0);
  }

  /** 首次開啟自動開始：播放模式、看過教學、手機小螢幕都不觸發 */
  function maybeAutoStart() {
    if (localStorage.getItem(DONE_KEY)) return;
    if (document.getElementById('playOverlay').classList.contains('active')) return;
    if (Mobile.isTouch && innerWidth <= 900) return;
    start();
  }

  return { start, maybeAutoStart };
})();
