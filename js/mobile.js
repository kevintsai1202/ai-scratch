/**
 * mobile.js — 手機版呈現模式
 *
 * 1. 播放模式：舞台依螢幕大小縮放、觸控裝置顯示虛擬方向鍵＋動作鍵
 * 2. 編輯模式：小螢幕觸控裝置顯示「建議用電腦編輯」提示橫幅
 *
 * 虛擬按鍵直接寫入 KEYS_DOWN（給「按鍵被按下？」偵測積木）並轉發
 * runtime.fireKey（給「當按鍵被按下」事件積木），按住時以固定頻率重發，
 * 行為等同實體鍵盤的自動重複。
 */
const Mobile = (() => {
  'use strict';

  /** 是否為觸控為主的裝置（手機/平板） */
  const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

  /** 虛擬按鍵配置：[顯示文字, KeyboardEvent.key, d-pad 格位置] */
  const PAD_KEYS = [
    ['▲', 'ArrowUp', 'up'], ['◀', 'ArrowLeft', 'left'],
    ['▶', 'ArrowRight', 'right'], ['▼', 'ArrowDown', 'down'],
  ];

  const repeatTimers = {}; // key → setInterval id（按住重發）

  /** 按下虛擬鍵：登錄按住狀態＋觸發事件＋啟動重發 */
  function press(key) {
    KEYS_DOWN.add(key);
    App.runtime?.fireKey(key);
    clearInterval(repeatTimers[key]);
    repeatTimers[key] = setInterval(() => App.runtime?.fireKey(key), 130);
  }

  /** 放開虛擬鍵 */
  function release(key) {
    KEYS_DOWN.delete(key);
    clearInterval(repeatTimers[key]);
    delete repeatTimers[key];
  }

  /** 建立單顆虛擬按鍵並綁定觸控/滑鼠事件（滑鼠是為了桌機測試） */
  function makePadButton(label, key, className) {
    const btn = document.createElement('button');
    btn.className = `pad-btn ${className}`;
    btn.dataset.key = key;
    btn.textContent = label;
    const down = (e) => { e.preventDefault(); btn.classList.add('held'); press(key); };
    const up = (e) => { e.preventDefault(); btn.classList.remove('held'); release(key); };
    btn.addEventListener('touchstart', down, { passive: false });
    btn.addEventListener('touchend', up);
    btn.addEventListener('touchcancel', up);
    btn.addEventListener('mousedown', down);
    btn.addEventListener('mouseup', up);
    btn.addEventListener('mouseleave', up);
    return btn;
  }

  /** 建立虛擬搖桿（掛在 body：播放模式與編輯模式執行中都能用） */
  function buildGamepad() {
    if (!isTouch || document.getElementById('gamepad')) return;
    const pad = document.createElement('div');
    pad.id = 'gamepad';
    const dpad = document.createElement('div');
    dpad.className = 'dpad';
    for (const [label, key, pos] of PAD_KEYS) dpad.appendChild(makePadButton(label, key, `pad-${pos}`));
    pad.appendChild(dpad);
    pad.appendChild(makePadButton('空白鍵', ' ', 'pad-action'));
    document.body.appendChild(pad);
  }

  /** 建立浮動 ▶/⏹ 鈕（觸控裝置編輯模式隨時能執行/停止） */
  function buildRunFab() {
    if (!isTouch || document.getElementById('fabRun')) return;
    const fab = document.createElement('button');
    fab.id = 'fabRun';
    fab.textContent = '▶';
    fab.title = '執行／停止';
    fab.addEventListener('click', () => { App.runtime ? App.stopRun() : App.run(); });
    document.body.appendChild(fab);
  }

  /** 依目前狀態同步搖桿與浮動鈕的顯示 */
  function syncControls() {
    const playing = document.getElementById('playOverlay').classList.contains('active');
    const running = !!(window.App && App.runtime);
    const pad = document.getElementById('gamepad');
    const fab = document.getElementById('fabRun');
    if (pad) pad.classList.toggle('show', isTouch && (playing || running));
    if (fab) {
      fab.style.display = (isTouch && !playing) ? 'block' : 'none';
      fab.textContent = running ? '⏹' : '▶';
      fab.classList.toggle('stop', running);
    }
  }

  /** 執行狀態變化時由 app.js 通知（run/stopRun/停止全部） */
  function onRunStateChanged() { syncControls(); }

  /**
   * Blockly v12 在觸控環境的已知問題：tap 分類後 flyout 仍 display:none。
   * 補丁：touchend 後確認 flyout 是否開啟，若未開啟則用 JS API 強制展開。
   */
  function fixToolboxTouch() {
    if (!isTouch) return;
    document.addEventListener('touchend', (e) => {
      const cat = e.target.closest('.blocklyToolboxCategory');
      if (!cat) return;
      setTimeout(() => {
        const flyout = document.querySelector('.blocklyToolboxFlyout');
        if (flyout && getComputedStyle(flyout).display !== 'none') return; // 已正常開啟
        try {
          const ws = Blockly.getMainWorkspace();
          const tb = ws?.getToolbox();
          if (!tb) return;
          const allCats = [...document.querySelectorAll('.blocklyToolboxCategory')];
          const idx = allCats.indexOf(cat);
          const items = tb.getToolboxItems();
          if (idx >= 0 && items[idx]) tb.setSelectedItem(items[idx]);
        } catch (err) { /* Blockly API 不支援時靜默略過 */ }
      }, 80);
    }, { passive: true });
  }

  /** 初始化（app.js init 時呼叫）：建立控制元件並捲回頁面頂端 */
  function setup() {
    buildGamepad();
    buildRunFab();
    fixToolboxTouch();
    syncControls();
    // Blockly 注入時可能把頁面捲走，強制回到頂端讓 header 與舞台可見
    requestAnimationFrame(() => window.scrollTo(0, 0));
  }

  /** 播放模式下把舞台縮放到塞滿螢幕（保留標題與按鍵的空間） */
  function scaleStage() {
    const wrap = document.getElementById('stageWrap');
    if (!document.getElementById('playOverlay').classList.contains('active')) {
      wrap.style.transform = ''; // 回編輯模式還原
      wrap.style.marginBottom = '';
      return;
    }
    const padH = isTouch ? 190 : 150; // 虛擬按鍵／按鈕保留高度
    const scale = Math.max(0.4, Math.min(
      (innerWidth - 16) / 480, (innerHeight - padH - 60) / 360, 2));
    wrap.style.transform = `scale(${scale})`;
    wrap.style.transformOrigin = 'top center';
    // transform 不改變版面佔位：用 margin 補償縮放差（放大補空間、縮小收空間）
    wrap.style.marginBottom = `${(scale - 1) * 360}px`;
  }

  /** 進入播放模式時呼叫（app.js enterPlayMode 內） */
  function onEnterPlayMode() {
    buildGamepad();
    scaleStage();
    document.getElementById('playOverlay').classList.toggle('touch', isTouch);
    syncControls();
  }

  /** 離開播放模式時呼叫 */
  function onExitPlayMode() { scaleStage(); syncControls(); }

  /** 編輯模式提示橫幅：小螢幕觸控裝置建議改用電腦編輯 */
  function maybeShowEditorTip() {
    if (!isTouch || innerWidth > 900) return;
    const bar = document.createElement('div');
    bar.id = 'mobileTip';
    bar.append('📱 手機適合「遊玩分享連結」；製作遊戲建議用電腦喔！');
    const ok = document.createElement('button');
    ok.textContent = '知道了';
    ok.addEventListener('click', () => bar.remove());
    bar.appendChild(ok);
    document.body.appendChild(bar);
  }

  window.addEventListener('resize', scaleStage);

  return { isTouch, setup, onEnterPlayMode, onExitPlayMode, onRunStateChanged, maybeShowEditorTip };
})();
window.Mobile = Mobile;
