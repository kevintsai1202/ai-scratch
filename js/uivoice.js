/**
 * uivoice.js — 兒童無障礙：選單點選唸出語音 ＋ 注音（ㄅㄆㄇ）標示
 *
 * 1. 注音標示：掃描 UI 文字節點，把字典內的國字包成 <ruby>字<rt>注音</rt></ruby>
 *    （跳過 SVG／輸入框／已標注過的節點；字典外的字保持原樣）
 * 2. 點選唸出：帶 data-speak 的元素被點擊時，用 TTS 唸出名稱；
 *    Blockly 工具箱分類在標注時自動掛上 data-speak
 * 3. 🔊 按鈕可開關語音（注音恆顯示），設定存 localStorage
 */
const UIVoice = (() => {
  'use strict';

  const VOICE_KEY = 'scratchy.uiVoice'; // '0' = 關閉點選語音
  let lastSpoken = '';                  // 最後唸出的內容（e2e 驗證用）

  /** 國字 → 注音字典（涵蓋本站選單與教學常用字；查無的字不標注） */
  const DICT = {
    新: 'ㄒㄧㄣ', 作: 'ㄗㄨㄛˋ', 品: 'ㄆㄧㄣˇ', 儲: 'ㄔㄨˊ', 存: 'ㄘㄨㄣˊ',
    開: 'ㄎㄞ', 啟: 'ㄑㄧˇ', 分: 'ㄈㄣ', 享: 'ㄒㄧㄤˇ', 教: 'ㄐㄧㄠ', 學: 'ㄒㄩㄝˊ',
    事: 'ㄕˋ', 件: 'ㄐㄧㄢˋ', 動: 'ㄉㄨㄥˋ', 外: 'ㄨㄞˋ', 觀: 'ㄍㄨㄢ',
    音: 'ㄧㄣ', 效: 'ㄒㄧㄠˋ', 控: 'ㄎㄨㄥˋ', 制: 'ㄓˋ', 偵: 'ㄓㄣ', 測: 'ㄘㄜˋ',
    運: 'ㄩㄣˋ', 算: 'ㄙㄨㄢˋ', 變: 'ㄅㄧㄢˋ', 數: 'ㄕㄨˋ', 角: 'ㄐㄧㄠˇ', 色: 'ㄙㄜˋ',
    執: 'ㄓˊ', 行: 'ㄒㄧㄥˊ', 停: 'ㄊㄧㄥˊ', 止: 'ㄓˇ', 遊: 'ㄧㄡˊ', 戲: 'ㄒㄧˋ',
    始: 'ㄕˇ', 編: 'ㄅㄧㄢ', 輯: 'ㄐㄧˊ', 這: 'ㄓㄜˋ', 個: 'ㄍㄜˋ', 我: 'ㄨㄛˇ',
    的: '˙ㄉㄜ', 已: 'ㄧˇ', 刪: 'ㄕㄢ', 除: 'ㄔㄨˊ', 關: 'ㄍㄨㄢ', 閉: 'ㄅㄧˋ',
    完: 'ㄨㄢˊ', 成: 'ㄔㄥˊ', 增: 'ㄗㄥ', 加: 'ㄐㄧㄚ', 貓: 'ㄇㄠ', 咪: 'ㄇㄧ',
    蘋: 'ㄆㄧㄥˊ', 果: 'ㄍㄨㄛˇ', 方: 'ㄈㄤ', 向: 'ㄒㄧㄤˋ', 大: 'ㄉㄚˋ', 小: 'ㄒㄧㄠˇ',
    顯: 'ㄒㄧㄢˇ', 示: 'ㄕˋ', 隱: 'ㄧㄣˇ', 藏: 'ㄘㄤˊ', 知: 'ㄓ', 道: 'ㄉㄠˋ',
    了: '˙ㄌㄜ', 下: 'ㄒㄧㄚˋ', 一: 'ㄧ', 步: 'ㄅㄨˋ', 跳: 'ㄊㄧㄠˋ', 躍: 'ㄩㄝˋ',
    金: 'ㄐㄧㄣ', 幣: 'ㄅㄧˋ', 雷: 'ㄌㄟˊ', 射: 'ㄕㄜˋ', 爆: 'ㄅㄠˋ', 炸: 'ㄓㄚˋ',
    叮: 'ㄉㄧㄥ', 唸: 'ㄋㄧㄢˋ', 出: 'ㄔㄨ', 直: 'ㄓˊ', 到: 'ㄉㄠˋ', 結: 'ㄐㄧㄝˊ',
    束: 'ㄕㄨˋ', 移: 'ㄧˊ', 點: 'ㄉㄧㄢˇ', 擊: 'ㄐㄧˊ', 被: 'ㄅㄟˋ', 按: 'ㄢˋ',
    鍵: 'ㄐㄧㄢˋ', 當: 'ㄉㄤ', 重: 'ㄔㄨㄥˊ', 複: 'ㄈㄨˋ', 無: 'ㄨˊ', 限: 'ㄒㄧㄢˋ',
    次: 'ㄘˋ', 如: 'ㄖㄨˊ', 否: 'ㄈㄡˇ', 則: 'ㄗㄜˊ', 等: 'ㄉㄥˇ', 待: 'ㄉㄞˋ',
    秒: 'ㄇㄧㄠˇ', 碰: 'ㄆㄥˋ', 邊: 'ㄅㄧㄢ', 緣: 'ㄩㄢˊ', 反: 'ㄈㄢˇ', 彈: 'ㄊㄢˊ',
    說: 'ㄕㄨㄛ', 話: 'ㄏㄨㄚˋ', 造: 'ㄗㄠˋ', 型: 'ㄒㄧㄥˊ', 換: 'ㄏㄨㄢˋ',
    尺: 'ㄔˇ', 寸: 'ㄘㄨㄣˋ', 設: 'ㄕㄜˋ', 為: 'ㄨㄟˊ', 全: 'ㄑㄩㄢˊ', 部: 'ㄅㄨˋ',
    名: 'ㄇㄧㄥˊ', 稱: 'ㄔㄥ', 空: 'ㄎㄨㄥ', 白: 'ㄅㄞˊ', 沒: 'ㄇㄟˊ', 有: 'ㄧㄡˇ',
    語: 'ㄩˇ', 聲: 'ㄕㄥ', 播: 'ㄅㄛˋ', 放: 'ㄈㄤˋ',
  };

  /** 是否開啟點選語音 */
  function voiceOn() { return localStorage.getItem(VOICE_KEY) !== '0'; }

  /** UI 點選唸出：先取消前一句，避免連點時排隊念不完 */
  function speakUI(text) {
    lastSpoken = String(text);
    if (!voiceOn()) return;
    SoundFX.cancelSpeech();
    SoundFX.speak(text);
  }

  /**
   * 把 root 內所有文字節點加上注音 ruby。
   * 工具箱分類順便掛 data-speak（點分類時唸出分類名）。
   */
  function annotate(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const p = n.parentElement;
        if (!p || p.closest('.zy, svg, script, style')) return NodeFilter.FILTER_REJECT;
        if (!/[一-鿿]/.test(n.nodeValue)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    for (const n of nodes) {
      const p = n.parentElement;
      // Blockly 工具箱的分類列：記下原始文字供點選唸出（v12 class 為 .blocklyToolbox）
      if (p.closest('.blocklyToolbox')) {
        const row = p.closest('.blocklyToolboxCategory') || p.closest('[role="treeitem"]') || p;
        row.dataset.speak = n.nodeValue.trim();
      }
      const frag = document.createDocumentFragment();
      for (const ch of n.nodeValue) {
        // 所有中文字統一包注音結構（查無注音的字給空位），高度與基線才會一致
        if (/[一-鿿]/.test(ch)) {
          const zy = document.createElement('span');
          zy.className = 'zy';
          const rt = document.createElement('span');
          rt.className = 'zy-rt';
          rt.textContent = DICT[ch] || '';
          const base = document.createElement('span');
          base.className = 'zy-bb';
          base.textContent = ch;
          zy.append(rt, base);
          frag.append(zy);
        } else {
          frag.append(ch);
        }
      }
      n.replaceWith(frag);
    }
  }

  /** 固定 UI 的唸出名稱表（id → 要唸的文字） */
  const SPEAK_IDS = {
    btnNew: '新作品', btnSave: '儲存', btnOpen: '開啟', btnShare: '分享',
    btnTutorial: '教學', btnRun: '執行', btnStop: '停止',
    btnPlayBig: '開始遊戲', btnEditShared: '編輯這個作品', btnVoice: '語音開關',
  };

  /** 建立 🔊 語音開關按鈕（放在工具列最後） */
  function buildVoiceToggle() {
    const btn = document.createElement('button');
    btn.id = 'btnVoice';
    btn.title = '開關選單點選語音（注音會一直顯示）';
    const sync = () => { btn.textContent = voiceOn() ? '🔊 語音' : '🔇 語音'; };
    btn.addEventListener('click', () => {
      localStorage.setItem(VOICE_KEY, voiceOn() ? '0' : '1');
      sync();
      if (voiceOn()) speakUI('語音打開了');
    });
    sync();
    document.querySelector('header').appendChild(btn);
  }

  /** 初始化：標注注音、掛 data-speak、點選唸出（事件委派一條搞定） */
  function init() {
    buildVoiceToggle();
    for (const [id, text] of Object.entries(SPEAK_IDS)) {
      document.getElementById(id)?.setAttribute('data-speak', text);
    }
    annotate(document.body);

    // 任何帶 data-speak 的元素被點到就唸（含之後動態加上的）
    document.addEventListener('click', (e) => {
      const t = e.target.closest?.('[data-speak]');
      if (t) speakUI(t.dataset.speak);
    }, true);
  }

  return { init, annotate, speakUI, get lastSpoken() { return lastSpoken; } };
})();
// 頂層 const 不會自動掛上 window，明確掛上讓跨檔案的 window.UIVoice?.xxx 防呆寫法生效
window.UIVoice = UIVoice;
