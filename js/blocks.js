/**
 * blocks.js — 自訂積木定義 + JavaScript 程式碼產生器
 *
 * 產生的程式碼會以 (runtime, sprite) 為參數、包在 async 函式體中執行：
 *   - 事件積木 → 向 runtime 註冊 async handler
 *   - 迴圈積木 → 每圈插入 `await runtime.tick()`（節流 + 可被 ⏹ 中斷）
 *   - 文字欄位一律經 JSON.stringify 轉義，避免拼接注入
 */
(function () {
  const G = javascript.javascriptGenerator; // Blockly v12 的 JS 產生器全域
  const Order = javascript.Order;

  /** Scratch 風格分類色 */
  const C = { event: '#FFBF00', motion: '#4C97FF', looks: '#9966FF', control: '#FFAB19', sensing: '#5CB1D6', sound: '#D65CD6' };

  /** 音效下拉選單（值對應 SoundFX 配方名） */
  const SOUND_OPTIONS = [
    ['啵', 'pop'], ['跳躍', 'jump'], ['金幣', 'coin'],
    ['雷射', 'laser'], ['叮', 'ding'], ['爆炸', 'boom'],
  ];

  /** 按鍵下拉選單選項（顯示文字, 程式值＝KeyboardEvent.key） */
  const KEY_OPTIONS = [
    ['空白鍵', ' '], ['↑', 'ArrowUp'], ['↓', 'ArrowDown'], ['←', 'ArrowLeft'], ['→', 'ArrowRight'],
    ['W', 'w'], ['A', 'a'], ['S', 's'], ['D', 'd'],
  ];

  /** 造型（emoji）下拉選單 */
  const COSTUME_OPTIONS = [
    ['🐱 貓', '🐱'], ['🐶 狗', '🐶'], ['🦊 狐狸', '🦊'], ['🐸 青蛙', '🐸'], ['👾 怪物', '👾'],
    ['🚀 火箭', '🚀'], ['⚽ 球', '⚽'], ['🍎 蘋果', '🍎'], ['⭐ 星星', '⭐'], ['💎 寶石', '💎'],
    ['🎈 氣球', '🎈'], ['🏀 籃球', '🏀'],
  ];

  /* ────────────── 積木外觀定義（JSON） ────────────── */
  Blockly.common.defineBlocksWithJsonArray([
    // ── 事件（C 形：事件發生時執行槽內積木） ──
    { type: 'event_whenflag', message0: '當 ▶ 被點擊 %1 %2',
      args0: [{ type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }],
      colour: C.event, tooltip: '按下綠色執行鈕時開始' },
    { type: 'event_whenkey', message0: '當 %1 鍵被按下 %2 %3',
      args0: [{ type: 'field_dropdown', name: 'KEY', options: KEY_OPTIONS },
              { type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }],
      colour: C.event, tooltip: '按下鍵盤指定按鍵時執行' },
    { type: 'event_whenclicked', message0: '當角色被點擊 %1 %2',
      args0: [{ type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }],
      colour: C.event, tooltip: '用滑鼠點擊這個角色時執行' },

    // ── 動作 ──
    { type: 'motion_move', message0: '移動 %1 點',
      args0: [{ type: 'input_value', name: 'STEPS', check: 'Number' }],
      previousStatement: null, nextStatement: null, colour: C.motion },
    { type: 'motion_turn_right', message0: '右轉 ↻ %1 度',
      args0: [{ type: 'input_value', name: 'DEG', check: 'Number' }],
      previousStatement: null, nextStatement: null, colour: C.motion },
    { type: 'motion_turn_left', message0: '左轉 ↺ %1 度',
      args0: [{ type: 'input_value', name: 'DEG', check: 'Number' }],
      previousStatement: null, nextStatement: null, colour: C.motion },
    { type: 'motion_goto_xy', message0: '移到 x: %1 y: %2',
      args0: [{ type: 'input_value', name: 'X', check: 'Number' },
              { type: 'input_value', name: 'Y', check: 'Number' }],
      inputsInline: true, previousStatement: null, nextStatement: null, colour: C.motion },
    { type: 'motion_point_dir', message0: '面朝 %1 度（0上 90右）',
      args0: [{ type: 'input_value', name: 'DIR', check: 'Number' }],
      previousStatement: null, nextStatement: null, colour: C.motion },
    { type: 'motion_change_x', message0: 'x 改變 %1',
      args0: [{ type: 'input_value', name: 'DX', check: 'Number' }],
      previousStatement: null, nextStatement: null, colour: C.motion },
    { type: 'motion_change_y', message0: 'y 改變 %1',
      args0: [{ type: 'input_value', name: 'DY', check: 'Number' }],
      previousStatement: null, nextStatement: null, colour: C.motion },
    { type: 'motion_bounce', message0: '碰到邊緣就反彈',
      previousStatement: null, nextStatement: null, colour: C.motion },

    // ── 外觀 ──
    { type: 'looks_say_for', message0: '說 %1 持續 %2 秒',
      args0: [{ type: 'input_value', name: 'TEXT' }, { type: 'input_value', name: 'SECS', check: 'Number' }],
      inputsInline: true, previousStatement: null, nextStatement: null, colour: C.looks },
    { type: 'looks_say', message0: '說 %1',
      args0: [{ type: 'input_value', name: 'TEXT' }],
      previousStatement: null, nextStatement: null, colour: C.looks, tooltip: '說空白文字可清除泡泡' },
    { type: 'looks_show', message0: '顯示', previousStatement: null, nextStatement: null, colour: C.looks },
    { type: 'looks_hide', message0: '隱藏', previousStatement: null, nextStatement: null, colour: C.looks },
    { type: 'looks_set_size', message0: '尺寸設為 %1 %%',
      args0: [{ type: 'input_value', name: 'SIZE', check: 'Number' }],
      previousStatement: null, nextStatement: null, colour: C.looks },
    { type: 'looks_costume', message0: '造型換成 %1',
      args0: [{ type: 'field_dropdown', name: 'COSTUME', options: COSTUME_OPTIONS }],
      previousStatement: null, nextStatement: null, colour: C.looks },

    // ── 音效 ──
    { type: 'sound_play', message0: '播放音效 %1',
      args0: [{ type: 'field_dropdown', name: 'SOUND', options: SOUND_OPTIONS }],
      previousStatement: null, nextStatement: null, colour: C.sound },
    { type: 'sound_tts', message0: '唸出 %1',
      args0: [{ type: 'input_value', name: 'TEXT' }],
      previousStatement: null, nextStatement: null, colour: C.sound,
      tooltip: '用自然語音唸出文字（不等唸完就繼續）' },
    { type: 'sound_tts_wait', message0: '唸出 %1 直到結束',
      args0: [{ type: 'input_value', name: 'TEXT' }],
      previousStatement: null, nextStatement: null, colour: C.sound,
      tooltip: '唸完才執行下一個積木' },

    // ── 控制 ──
    { type: 'control_wait', message0: '等待 %1 秒',
      args0: [{ type: 'input_value', name: 'SECS', check: 'Number' }],
      previousStatement: null, nextStatement: null, colour: C.control },
    { type: 'control_repeat', message0: '重複 %1 次 %2 %3',
      args0: [{ type: 'input_value', name: 'TIMES', check: 'Number' },
              { type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }],
      previousStatement: null, nextStatement: null, colour: C.control },
    { type: 'control_forever', message0: '重複無限次 %1 %2',
      args0: [{ type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }],
      previousStatement: null, colour: C.control, tooltip: '直到按 ⏹ 或「停止全部」' },
    { type: 'control_stop', message0: '停止全部 ⏹',
      previousStatement: null, colour: C.control },

    // ── 分身 ──
    { type: 'control_clone', message0: '產生自己的分身',
      previousStatement: null, nextStatement: null, colour: C.control },
    { type: 'control_delete_clone', message0: '刪除這個分身',
      previousStatement: null, colour: C.control },
    { type: 'event_whencloned', message0: '當分身產生時 %1 %2',
      args0: [{ type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }],
      colour: C.event, tooltip: '分身被建立時執行此程式' },

    // ── 偵測 ──
    { type: 'sensing_touching_edge', message0: '碰到邊緣？', output: 'Boolean', colour: C.sensing },
    { type: 'sensing_keydown', message0: '%1 鍵被按下？',
      args0: [{ type: 'field_dropdown', name: 'KEY', options: KEY_OPTIONS }],
      output: 'Boolean', colour: C.sensing },
    { type: 'sensing_x', message0: 'x 座標', output: 'Number', colour: C.sensing },
    { type: 'sensing_y', message0: 'y 座標', output: 'Number', colour: C.sensing },
  ]);

  /**
   * 「碰到 [角色]？」— 下拉選項需動態列出目前作品的角色，
   * 因此用 JS 定義（options 為函式，每次展開選單時重新取得）。
   */
  Blockly.Blocks['sensing_touching'] = {
    init() {
      this.appendDummyInput()
        .appendField('碰到')
        .appendField(new Blockly.FieldDropdown(() =>
          (window.App && App.spriteOptions().length) ? App.spriteOptions() : [['（無角色）', '__none__']]
        ), 'SPRITE')
        .appendField('？');
      this.setOutput(true, 'Boolean');
      this.setColour(C.sensing);
      this.setTooltip('是否碰到指定名稱的角色');
    },
  };

  /* ────────────── 程式碼產生器 ────────────── */

  // 事件積木：把執行槽包成 async handler 註冊到 runtime
  G.forBlock['event_whenflag'] = (block, gen) => {
    const body = gen.statementToCode(block, 'DO');
    return `runtime.whenFlag(sprite, async () => {\n${body}});\n`;
  };
  G.forBlock['event_whenkey'] = (block, gen) => {
    const body = gen.statementToCode(block, 'DO');
    const key = JSON.stringify(block.getFieldValue('KEY'));
    return `runtime.whenKey(sprite, ${key}, async () => {\n${body}});\n`;
  };
  G.forBlock['event_whenclicked'] = (block, gen) => {
    const body = gen.statementToCode(block, 'DO');
    return `runtime.whenClicked(sprite, async () => {\n${body}});\n`;
  };

  /** 數值輸入的便利取值（空缺時用預設值） */
  const num = (gen, block, name, dflt) => gen.valueToCode(block, name, Order.NONE) || String(dflt);

  G.forBlock['motion_move'] = (b, g) => `sprite.move(${num(g, b, 'STEPS', 10)});\n`;
  G.forBlock['motion_turn_right'] = (b, g) => `sprite.turn(${num(g, b, 'DEG', 15)});\n`;
  G.forBlock['motion_turn_left'] = (b, g) => `sprite.turn(-(${num(g, b, 'DEG', 15)}));\n`;
  G.forBlock['motion_goto_xy'] = (b, g) => `sprite.gotoXY(${num(g, b, 'X', 0)}, ${num(g, b, 'Y', 0)});\n`;
  G.forBlock['motion_point_dir'] = (b, g) => `sprite.pointDir(${num(g, b, 'DIR', 90)});\n`;
  G.forBlock['motion_change_x'] = (b, g) => `sprite.changeX(${num(g, b, 'DX', 10)});\n`;
  G.forBlock['motion_change_y'] = (b, g) => `sprite.changeY(${num(g, b, 'DY', 10)});\n`;
  G.forBlock['motion_bounce'] = () => `sprite.bounceOnEdge();\n`;

  G.forBlock['looks_say_for'] = (b, g) =>
    `await runtime.sayFor(sprite, ${g.valueToCode(b, 'TEXT', Order.NONE) || "''"}, ${num(g, b, 'SECS', 2)});\n`;
  G.forBlock['looks_say'] = (b, g) => `sprite.say(${g.valueToCode(b, 'TEXT', Order.NONE) || "''"});\n`;
  G.forBlock['looks_show'] = () => `sprite.show();\n`;
  G.forBlock['looks_hide'] = () => `sprite.hide();\n`;
  G.forBlock['looks_set_size'] = (b, g) => `sprite.setSize(${num(g, b, 'SIZE', 100)});\n`;
  G.forBlock['looks_costume'] = (b) => `sprite.setCostume(${JSON.stringify(b.getFieldValue('COSTUME'))});\n`;

  G.forBlock['sound_play'] = (b) => `SoundFX.play(${JSON.stringify(b.getFieldValue('SOUND'))});\n`;
  G.forBlock['sound_tts'] = (b, g) =>
    `runtime.speak(${g.valueToCode(b, 'TEXT', Order.NONE) || "''"}, false);\n`;
  G.forBlock['sound_tts_wait'] = (b, g) =>
    `await runtime.speak(${g.valueToCode(b, 'TEXT', Order.NONE) || "''"}, true);\n`;

  G.forBlock['control_wait'] = (b, g) => `await runtime.wait(${num(g, b, 'SECS', 1)});\n`;
  G.forBlock['control_repeat'] = (b, g) => {
    const body = g.statementToCode(b, 'DO');
    const times = num(g, b, 'TIMES', 10);
    // 每圈 await tick：與畫面同步、可被停止
    return `for (let __i = 0, __n = Number(${times}); __i < __n; __i++) {\n${body}  await runtime.tick();\n}\n`;
  };
  G.forBlock['control_forever'] = (b, g) => {
    const body = g.statementToCode(b, 'DO');
    return `while (true) {\n${body}  await runtime.tick();\n}\n`;
  };
  G.forBlock['control_stop'] = () => `runtime.stopAll();\n`;

  G.forBlock['control_clone'] = () => `runtime.createClone(sprite);\n`;
  G.forBlock['control_delete_clone'] = () => `runtime.deleteClone(sprite);\n`;
  G.forBlock['event_whencloned'] = (block, gen) => {
    const body = gen.statementToCode(block, 'DO');
    return `runtime.whenCloned(sprite, async (__cloneSprite) => {\nconst sprite = __cloneSprite;\n${body}});\n`;
  };

  G.forBlock['sensing_touching'] = (b) =>
    [`sprite.touching(${JSON.stringify(b.getFieldValue('SPRITE'))})`, Order.FUNCTION_CALL];
  G.forBlock['sensing_touching_edge'] = () => ['sprite.touchingEdge()', Order.FUNCTION_CALL];
  G.forBlock['sensing_keydown'] = (b) =>
    [`runtime.isKeyDown(${JSON.stringify(b.getFieldValue('KEY'))})`, Order.FUNCTION_CALL];
  G.forBlock['sensing_x'] = () => ['sprite.x', Order.MEMBER];
  G.forBlock['sensing_y'] = () => ['sprite.y', Order.MEMBER];

  /**
   * 變數積木改寫：內建產生器會宣告區域變數（各角色不互通），
   * 這裡導向 runtime 的全域變數表，並以「變數顯示名稱」為鍵（舞台顯示用同一名稱）。
   */
  function varNameOf(block) {
    const id = block.getFieldValue('VAR');
    const map = block.workspace.getVariableMap?.();
    const v = map?.getVariableById ? map.getVariableById(id)
      : (block.workspace.getVariableById ? block.workspace.getVariableById(id) : null);
    const name = v ? (typeof v.getName === 'function' ? v.getName() : v.name) : String(id);
    return JSON.stringify(name);
  }
  G.forBlock['variables_get'] = (b) => [`runtime.getVar(${varNameOf(b)})`, Order.FUNCTION_CALL];
  G.forBlock['variables_set'] = (b, g) =>
    `runtime.setVar(${varNameOf(b)}, ${g.valueToCode(b, 'VALUE', Order.NONE) || '0'});\n`;
  G.forBlock['math_change'] = (b, g) =>
    `runtime.changeVar(${varNameOf(b)}, ${g.valueToCode(b, 'DELTA', Order.NONE) || '0'});\n`;

  /* ────────────── 工具箱（分類） ────────────── */
  window.TOOLBOX = {
    kind: 'categoryToolbox',
    contents: [
      { kind: 'category', name: '事件', colour: C.event, contents: [
        { kind: 'block', type: 'event_whenflag' },
        { kind: 'block', type: 'event_whenkey' },
        { kind: 'block', type: 'event_whenclicked' },
        { kind: 'block', type: 'event_whencloned' },
      ]},
      { kind: 'category', name: '動作', colour: C.motion, contents: [
        { kind: 'block', type: 'motion_move', inputs: { STEPS: { shadow: { type: 'math_number', fields: { NUM: 10 } } } } },
        { kind: 'block', type: 'motion_turn_right', inputs: { DEG: { shadow: { type: 'math_number', fields: { NUM: 15 } } } } },
        { kind: 'block', type: 'motion_turn_left', inputs: { DEG: { shadow: { type: 'math_number', fields: { NUM: 15 } } } } },
        { kind: 'block', type: 'motion_goto_xy', inputs: {
          X: { shadow: { type: 'math_number', fields: { NUM: 0 } } },
          Y: { shadow: { type: 'math_number', fields: { NUM: 0 } } } } },
        { kind: 'block', type: 'motion_point_dir', inputs: { DIR: { shadow: { type: 'math_number', fields: { NUM: 90 } } } } },
        { kind: 'block', type: 'motion_change_x', inputs: { DX: { shadow: { type: 'math_number', fields: { NUM: 10 } } } } },
        { kind: 'block', type: 'motion_change_y', inputs: { DY: { shadow: { type: 'math_number', fields: { NUM: 10 } } } } },
        { kind: 'block', type: 'motion_bounce' },
      ]},
      { kind: 'category', name: '外觀', colour: C.looks, contents: [
        { kind: 'block', type: 'looks_say_for', inputs: {
          TEXT: { shadow: { type: 'text', fields: { TEXT: '你好！' } } },
          SECS: { shadow: { type: 'math_number', fields: { NUM: 2 } } } } },
        { kind: 'block', type: 'looks_say', inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: '你好！' } } } } },
        { kind: 'block', type: 'looks_show' },
        { kind: 'block', type: 'looks_hide' },
        { kind: 'block', type: 'looks_set_size', inputs: { SIZE: { shadow: { type: 'math_number', fields: { NUM: 100 } } } } },
        { kind: 'block', type: 'looks_costume' },
      ]},
      { kind: 'category', name: '音效', colour: C.sound, contents: [
        { kind: 'block', type: 'sound_play' },
        { kind: 'block', type: 'sound_tts', inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: '你好！' } } } } },
        { kind: 'block', type: 'sound_tts_wait', inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: '遊戲開始！' } } } } },
      ]},
      { kind: 'category', name: '控制', colour: C.control, contents: [
        { kind: 'block', type: 'control_wait', inputs: { SECS: { shadow: { type: 'math_number', fields: { NUM: 1 } } } } },
        { kind: 'block', type: 'control_repeat', inputs: { TIMES: { shadow: { type: 'math_number', fields: { NUM: 10 } } } } },
        { kind: 'block', type: 'control_forever' },
        { kind: 'block', type: 'controls_if' },
        { kind: 'block', type: 'controls_if', extraState: { hasElse: true } },
        { kind: 'block', type: 'control_stop' },
        { kind: 'block', type: 'control_clone' },
        { kind: 'block', type: 'control_delete_clone' },
      ]},
      { kind: 'category', name: '偵測', colour: C.sensing, contents: [
        { kind: 'block', type: 'sensing_touching' },
        { kind: 'block', type: 'sensing_touching_edge' },
        { kind: 'block', type: 'sensing_keydown' },
        { kind: 'block', type: 'sensing_x' },
        { kind: 'block', type: 'sensing_y' },
      ]},
      { kind: 'category', name: '運算', colour: '#59C059', contents: [
        { kind: 'block', type: 'math_number' },
        { kind: 'block', type: 'math_arithmetic', inputs: {
          A: { shadow: { type: 'math_number', fields: { NUM: 1 } } },
          B: { shadow: { type: 'math_number', fields: { NUM: 1 } } } } },
        { kind: 'block', type: 'math_random_int', inputs: {
          FROM: { shadow: { type: 'math_number', fields: { NUM: 1 } } },
          TO: { shadow: { type: 'math_number', fields: { NUM: 10 } } } } },
        { kind: 'block', type: 'logic_compare' },
        { kind: 'block', type: 'logic_operation' },
        { kind: 'block', type: 'logic_negate' },
        { kind: 'block', type: 'text' },
      ]},
      { kind: 'category', name: '變數', colour: '#FF8C1A', custom: 'VARIABLE' },
    ],
  };
})();
