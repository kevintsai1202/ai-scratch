/**
 * ai-input.js — AI 自然語言生積木：DSL→Blockly 轉換、UI 面板、語音輸入
 */
const AIInput = (() => {
  'use strict';

  /**
   * 把單一 DSL 指令轉為 Blockly serialization 格式的 block 物件
   * @param {Object} cmd DSL 指令
   * @returns {Object} Blockly block JSON
   */
  /**
   * 把值（數字、隨機數、表達式物件）轉為 Blockly input
   * @param {number|Object} val 值或表達式
   * @returns {Object} Blockly input JSON（shadow 或 block）
   */
  function valueToInput(val) {
    if (typeof val === 'number') {
      return { shadow: { type: 'math_number', fields: { NUM: val } } };
    }
    if (val && typeof val === 'object') {
      // 隨機數簡寫：{randomFrom, randomTo}
      if (val.randomFrom !== undefined) {
        return { block: exprToBlock({ type: 'math_random_int', from: val.randomFrom, to: val.randomTo }) };
      }
      // 其他表達式（變數、運算、座標等）
      if (val.type) {
        return { block: exprToBlock(val) };
      }
    }
    return { shadow: { type: 'math_number', fields: { NUM: Number(val) || 0 } } };
  }

  function cmdToBlock(cmd) {
    const block = { type: cmd.type };

    /** 數值輸入對應表：DSL 參數名 → Blockly input name */
    const numInputs = {
      steps: 'STEPS', degrees: 'DEG', x: 'X', y: 'Y', direction: 'DIR',
      dx: 'DX', dy: 'DY', size: 'SIZE', seconds: 'SECS', times: 'TIMES',
    };
    /** 文字輸入對應表 */
    const textInputs = { text: 'TEXT' };
    /** 下拉欄位對應表 */
    const fieldMap = {
      key: 'KEY', costume: 'COSTUME', sound: 'SOUND', sprite: 'SPRITE',
    };

    const inputs = {};
    const fields = {};

    for (const [dslKey, blockInput] of Object.entries(numInputs)) {
      if (cmd[dslKey] !== undefined) {
        inputs[blockInput] = valueToInput(cmd[dslKey]);
      }
    }
    for (const [dslKey, blockInput] of Object.entries(textInputs)) {
      if (cmd[dslKey] !== undefined) {
        const val = cmd[dslKey];
        if (val && typeof val === 'object' && val.type) {
          inputs[blockInput] = { block: exprToBlock(val) };
        } else {
          inputs[blockInput] = { shadow: { type: 'text', fields: { TEXT: String(val) } } };
        }
      }
    }
    for (const [dslKey, fieldName] of Object.entries(fieldMap)) {
      if (cmd[dslKey] !== undefined) {
        fields[fieldName] = String(cmd[dslKey]);
      }
    }

    if (Object.keys(inputs).length) block.inputs = inputs;
    if (Object.keys(fields).length) block.fields = fields;

    // variables_set 特殊處理：變數名 → VAR 欄位，value → VALUE 輸入
    if (cmd.type === 'variables_set' && cmd.name !== undefined) {
      block.fields = { VAR: { name: String(cmd.name) } };
      if (!block.inputs) block.inputs = {};
      block.inputs.VALUE = cmd.value !== undefined ? valueToInput(cmd.value)
        : { shadow: { type: 'math_number', fields: { NUM: 0 } } };
      return block;
    }

    // math_change 特殊處理：變數名 → VAR 欄位，delta → DELTA 輸入
    if (cmd.type === 'math_change' && cmd.name !== undefined) {
      block.fields = { VAR: { name: String(cmd.name) } };
      if (!block.inputs) block.inputs = {};
      block.inputs.DELTA = cmd.delta !== undefined ? valueToInput(cmd.delta)
        : { shadow: { type: 'math_number', fields: { NUM: 1 } } };
      return block;
    }

    // controls_if 特殊處理：condition → IF0 輸入，body → DO0，elseBody → ELSE
    if (cmd.type === 'controls_if') {
      if (!block.inputs) block.inputs = {};
      if (cmd.condition) block.inputs.IF0 = { block: conditionToBlock(cmd.condition) };
      if (Array.isArray(cmd.body) && cmd.body.length) block.inputs.DO0 = { block: chainBlocks(cmd.body) };
      if (Array.isArray(cmd.elseBody) && cmd.elseBody.length) {
        block.extraState = { hasElse: true };
        block.inputs.ELSE = { block: chainBlocks(cmd.elseBody) };
      }
      return block;
    }

    // body → statement input "DO"
    if (Array.isArray(cmd.body) && cmd.body.length > 0) {
      if (!block.inputs) block.inputs = {};
      block.inputs.DO = { block: chainBlocks(cmd.body) };
    }

    return block;
  }

  /**
   * 把值表達式轉為 Blockly block（用於 if 條件、運算輸入等）
   * 支援：偵測積木、變數讀取、四則運算、比較、邏輯運算、座標
   * @param {Object|string} expr 表達式物件或簡寫字串
   * @returns {Object} Blockly block JSON
   */
  function exprToBlock(expr) {
    if (typeof expr === 'string') return { type: expr };
    if (typeof expr === 'number') return { type: 'math_number', fields: { NUM: expr } };

    const block = { type: expr.type };
    const fields = {};
    const inputs = {};

    // 偵測積木的欄位
    if (expr.sprite !== undefined) fields.SPRITE = String(expr.sprite);
    if (expr.key !== undefined) fields.KEY = String(expr.key);

    // variables_get：讀取變數
    if (expr.type === 'variables_get' && expr.name !== undefined) {
      block.fields = { VAR: { name: String(expr.name) } };
      return block;
    }

    // math_arithmetic：四則運算（a op b）
    if (expr.type === 'math_arithmetic') {
      const opMap = { '+': 'ADD', '-': 'MINUS', '*': 'MULTIPLY', '/': 'DIVIDE' };
      fields.OP = opMap[expr.op] || 'ADD';
      if (expr.a !== undefined) inputs.A = { block: exprToBlock(expr.a) };
      if (expr.b !== undefined) inputs.B = { block: exprToBlock(expr.b) };
    }

    // logic_compare：比較運算（a op b）
    if (expr.type === 'logic_compare') {
      const opMap = { '=': 'EQ', '!=': 'NEQ', '<': 'LT', '>': 'GT', '<=': 'LTE', '>=': 'GTE' };
      fields.OP = opMap[expr.op] || 'EQ';
      if (expr.a !== undefined) inputs.A = { block: exprToBlock(expr.a) };
      if (expr.b !== undefined) inputs.B = { block: exprToBlock(expr.b) };
    }

    // logic_operation：邏輯且/或
    if (expr.type === 'logic_operation') {
      fields.OP = expr.op === 'or' ? 'OR' : 'AND';
      if (expr.a !== undefined) inputs.A = { block: exprToBlock(expr.a) };
      if (expr.b !== undefined) inputs.B = { block: exprToBlock(expr.b) };
    }

    // logic_negate：邏輯非
    if (expr.type === 'logic_negate') {
      if (expr.value !== undefined) inputs.BOOL = { block: exprToBlock(expr.value) };
    }

    // math_random_int
    if (expr.type === 'math_random_int') {
      if (expr.from !== undefined) inputs.FROM = { block: exprToBlock(expr.from) };
      if (expr.to !== undefined) inputs.TO = { block: exprToBlock(expr.to) };
    }

    if (Object.keys(fields).length) block.fields = fields;
    if (Object.keys(inputs).length) block.inputs = inputs;
    return block;
  }

  /** conditionToBlock 向下相容：直接呼叫 exprToBlock */
  function conditionToBlock(cond) { return exprToBlock(cond); }

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

  /** 用 DSL 完整替換目前工作區的積木（編輯模式用） */
  function replaceWorkspace(dslArray) {
    const ws = Blockly.getMainWorkspace();
    if (!ws || !dslArray?.length) return;
    const state = dslToWorkspace(dslArray);
    ws.clear();
    Blockly.serialization.workspaces.load(state, ws);
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
          <div id="aiEditHint" class="ai-hint" style="display:none">📝 已偵測到現有積木，AI 會基於目前程式修改</div>
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) document.getElementById('aiMic').style.display = 'none';

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
    if (show) {
      document.getElementById('aiPrompt').focus();
      const hasCode = !!getCurrentCode();
      const hint = document.getElementById('aiEditHint');
      if (hint) hint.style.display = hasCode ? 'block' : 'none';
    }
  }

  /** 取得目前選取角色的程式碼（供 AI 參考現有積木） */
  function getCurrentCode() {
    try {
      const ws = Blockly.getMainWorkspace();
      if (!ws || !ws.getTopBlocks(true).length) return '';
      return javascript.javascriptGenerator.workspaceToCode(ws);
    } catch { return ''; }
  }

  /** 送出 AI 請求（自動附帶目前角色的積木程式供 AI 參考） */
  async function sendPrompt() {
    const input = document.getElementById('aiPrompt');
    const prompt = input.value.trim();
    if (!prompt) return;

    const loading = document.getElementById('aiLoading');
    const sendBtn = document.getElementById('aiSend');
    loading.style.display = 'block';
    sendBtn.disabled = true;

    const currentCode = getCurrentCode();
    const editMode = !!currentCode;

    try {
      const res = await fetch('/api/ai/blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, currentCode: currentCode || undefined }),
      });
      const data = await res.json();

      if (!res.ok) {
        showToast(data.error || 'AI 請求失敗');
        return;
      }

      if (data.sprites) {
        handleMultiSprite(data.sprites);
      } else if (data.dsl) {
        if (editMode) {
          replaceWorkspace(data.dsl);
          showToast('積木已更新');
        } else {
          const count = loadDslToWorkspace(data.dsl);
          showToast(`已加入 ${count} 個積木`);
        }
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

  /** 多角色 AI 生成：清除現有作品並建立全新角色組合 */
  function handleMultiSprite(sprites) {
    if (!sprites?.length) { showToast('AI 沒有產生任何角色'); return; }
    if (!confirm(`AI 要建立 ${sprites.length} 個角色的遊戲，會取代目前的作品。確定嗎？`)) return;

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

  /** 顯示 toast */
  function showToast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2600);
  }

  /** 初始化 */
  function setup() { buildPanel(); }

  return { setup, togglePanel, dslToWorkspace, loadDslToWorkspace };
})();
window.AIInput = AIInput;
