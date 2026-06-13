/**
 * engine.js — 舞台渲染、角色（Sprite）、執行期（Runtime）
 *
 * 座標採 Scratch 慣例：舞台 480×360、中心為原點、y 軸向上、方向 90 度 = 朝右。
 * 每次按 ▶ 會建立全新 Runtime；舊 Runtime 設 stopped 後，殘留的 async 執行緒
 * 會在下一次 tick()/wait() 拋出 StopSignal 自行終止，避免殭屍迴圈。
 */

/** 舞台尺寸常數 */
const STAGE_W = 480;
const STAGE_H = 360;
/** 角色基準字級：大小 100% 時 emoji 的繪製字級（px） */
const SPRITE_BASE_SIZE = 48;

/** 分身數量上限（單一角色 60，全域 300） */
const MAX_CLONES_PER_SPRITE = 60;
const MAX_CLONES_TOTAL = 300;

/** 目前按住的按鍵集合（KeyboardEvent.key；由 app.js 的全域監聯維護） */
const KEYS_DOWN = new Set();

/** 自訂圖片快取（costume img:xxx → Image 物件） */
const IMAGE_CACHE = new Map();
/** 預載自訂圖片（若尚未載入則啟動載入，回傳 Image 或 null） */
function getCostumeImage(costume) {
  if (!costume?.startsWith('img:')) return null;
  const id = costume.slice(4);
  if (IMAGE_CACHE.has(id)) return IMAGE_CACHE.get(id);
  const img = new Image();
  img.src = `/api/images/${id}.png`;
  IMAGE_CACHE.set(id, null);
  img.onload = () => IMAGE_CACHE.set(id, img);
  return null;
}

/** 停止訊號：tick/wait 偵測到 Runtime 停止時拋出，讓 async 執行緒安靜結束 */
class StopSignal extends Error {
  constructor() { super('stopped'); this.isStopSignal = true; }
}

/**
 * 執行期角色：由角色設定（config）複製而來，積木程式操作的對象。
 * 不直接改 config，停止後編輯器仍顯示原始擺位。
 */
class RuntimeSprite {
  constructor(config, runtime) {
    this.runtime = runtime;
    this.id = config.id;
    this.name = config.name;
    this.costume = config.costume;   // emoji 造型
    this.x = config.x;
    this.y = config.y;
    this.dir = config.dir;           // Scratch 方向：0=上 90=右
    this.size = config.size;         // 百分比
    this.visible = config.visible;
    this.sayText = '';               // 對話泡泡文字
    this.isClone = false;       // 是否為分身
    this.cloneParentId = null;  // 分身的來源角色 ID
  }

  /** 沿目前方向移動 steps 點（Scratch 公式：dx=sin(dir)、dy=cos(dir)） */
  move(steps) {
    const rad = this.dir * Math.PI / 180;
    this.x += Math.sin(rad) * Number(steps);
    this.y += Math.cos(rad) * Number(steps);
  }

  /** 右轉 deg 度（負值即左轉） */
  turn(deg) { this.dir = wrapDir(this.dir + Number(deg)); }

  /** 移到絕對座標 */
  gotoXY(x, y) { this.x = Number(x); this.y = Number(y); }

  /** 面朝指定方向 */
  pointDir(deg) { this.dir = wrapDir(Number(deg)); }

  changeX(dx) { this.x += Number(dx); }
  changeY(dy) { this.y += Number(dy); }

  /** 碰到舞台邊緣就反彈（鏡射方向並夾回舞台內） */
  bounceOnEdge() {
    const half = this.halfBox();
    const rad = this.dir * Math.PI / 180;
    let vx = Math.sin(rad), vy = Math.cos(rad);
    if (this.x - half < -STAGE_W / 2 || this.x + half > STAGE_W / 2) vx = -vx;
    if (this.y - half < -STAGE_H / 2 || this.y + half > STAGE_H / 2) vy = -vy;
    this.dir = wrapDir(Math.atan2(vx, vy) * 180 / Math.PI); // atan2(x,y) 直接得 Scratch 方向
    this.x = clamp(this.x, -STAGE_W / 2 + half, STAGE_W / 2 - half);
    this.y = clamp(this.y, -STAGE_H / 2 + half, STAGE_H / 2 - half);
  }

  say(text) { this.sayText = String(text ?? ''); }
  show() { this.visible = true; }
  hide() { this.visible = false; }
  setSize(pct) { this.size = Math.max(5, Number(pct)); }
  setCostume(emoji) { this.costume = emoji; }

  /** 碰撞半徑（以大小換算的半邊長，AABB 用） */
  halfBox() { return SPRITE_BASE_SIZE * (this.size / 100) * 0.5; }

  /** 是否碰到指定名稱的角色（AABB 重疊，雙方都要可見） */
  touching(name) {
    if (!this.visible) return false;
    return this.runtime.sprites.some(s =>
      s !== this && s.name === name && s.visible &&
      Math.abs(s.x - this.x) < s.halfBox() + this.halfBox() &&
      Math.abs(s.y - this.y) < s.halfBox() + this.halfBox()
    );
  }

  /** 是否碰到舞台邊緣 */
  touchingEdge() {
    const half = this.halfBox();
    return this.x - half <= -STAGE_W / 2 || this.x + half >= STAGE_W / 2 ||
           this.y - half <= -STAGE_H / 2 || this.y + half >= STAGE_H / 2;
  }
}

/** 方向正規化到 (-180, 180]（Scratch 慣例） */
function wrapDir(d) {
  d = ((d % 360) + 360) % 360;
  return d > 180 ? d - 360 : d;
}
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

/**
 * Runtime：一次「執行」的生命週期。
 * 持有執行期角色、全域變數、事件 handler 註冊表與停止旗標。
 */
class Runtime {
  /** @param {Array} spriteConfigs 角色設定陣列（編輯器資料） */
  constructor(spriteConfigs) {
    this.stopped = false;
    this.vars = Object.create(null);              // 全域變數表（變數積木共用）
    this.sprites = spriteConfigs.map(c => new RuntimeSprite(c, this));
    this.flagHandlers = [];                        // [{sprite, fn}]
    this.keyHandlers = [];                         // [{sprite, key, fn}]
    this.clickHandlers = [];                       // [{sprite, fn}]
    this.cloneHandlers = [];    // [{sprite, fn}] 當分身產生事件
    this.onEffect = null;       // 效果回呼（帥氣模式用）
  }

  /* ── 事件註冊（由產生的程式碼呼叫） ── */
  whenFlag(sprite, fn) { this.flagHandlers.push({ sprite, fn }); }
  whenKey(sprite, key, fn) { this.keyHandlers.push({ sprite, key, fn }); }
  whenClicked(sprite, fn) { this.clickHandlers.push({ sprite, fn }); }

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

    // 觸發此角色的「當分身產生」handler，以分身為 sprite 執行
    this.cloneHandlers
      .filter(h => h.sprite.id === sprite.id)
      .forEach(h => {
        const cloneFn = h.fn.bind(null, clone);
        this.spawn(() => cloneFn());
      });

    // 通知舞台產生分身爆裂效果（帥氣模式用）
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
  }

  /** 刪除分身（僅分身可刪，本體忽略） */
  deleteClone(sprite) {
    if (!sprite.isClone) return;
    const idx = this.sprites.indexOf(sprite);
    if (idx !== -1) this.sprites.splice(idx, 1);
  }

  /** 啟動：觸發所有綠旗 handler */
  start() {
    this.flagHandlers.forEach(h => this.spawn(h.fn));
  }

  /** 鍵盤事件派發（由 app.js 的全域監聽轉送） */
  fireKey(key) {
    this.keyHandlers.filter(h => h.key === key).forEach(h => this.spawn(h.fn));
  }

  /** 角色被點擊派發 */
  fireClick(sprite) {
    this.clickHandlers.filter(h => h.sprite === sprite).forEach(h => this.spawn(h.fn));
  }

  /** 啟動一條執行緒：吞掉 StopSignal，其餘錯誤回報 */
  spawn(fn) {
    Promise.resolve().then(fn).catch(err => {
      if (!err?.isStopSignal) console.error('積木程式執行錯誤：', err);
    });
  }

  /** 停止本次執行：殘留執行緒於下個 tick 終止，並停掉語音 */
  stop() {
    this.stopped = true;
    if (typeof SoundFX !== 'undefined') SoundFX.cancelSpeech();
  }

  /**
   * 唸出文字（音效積木）：wait=true 時等唸完才繼續，
   * 唸完後若已被 ⏹ 停止則拋出 StopSignal 終止該執行緒。
   */
  async speak(text, wait) {
    const p = SoundFX.speak(text);
    if (wait) {
      await p;
      if (this.stopped) throw new StopSignal();
    }
  }

  /**
   * 讓出一個畫格並檢查停止旗標。
   * 所有迴圈積木每圈都會 await 本方法 → 與畫面更新同步且可被 ⏹ 中斷。
   */
  tick() {
    if (this.stopped) throw new StopSignal();
    return new Promise(res => requestAnimationFrame(() => {
      if (this.stopped) return; // 停止後不再喚醒（執行緒永遠懸掛，最終被 GC）
      res();
    }));
  }

  /** 等待 secs 秒（可被停止中斷） */
  async wait(secs) {
    const end = performance.now() + Number(secs) * 1000;
    while (performance.now() < end) await this.tick();
  }

  /** 「說 n 秒」：說完自動清除泡泡 */
  async sayFor(sprite, text, secs) {
    sprite.say(text);
    await this.wait(secs);
    sprite.say('');
  }

  /** 偵測積木：某鍵目前是否按住 */
  isKeyDown(key) { return KEYS_DOWN.has(key); }

  /* ── 變數（變數積木的產生器都導向這裡，未初始化視為 0） ── */
  getVar(name) { return this.vars[name] ?? 0; }
  setVar(name, val) { this.vars[name] = val; }
  changeVar(name, delta) { this.vars[name] = Number(this.getVar(name)) + Number(delta); }

  /** 停止全部（停止積木用）：通知 app 層同步 UI 狀態 */
  stopAll() {
    this.stop();
    if (typeof this.onStopAll === 'function') this.onStopAll();
  }
}

/**
 * Stage：負責把「角色列表 + 變數表」畫到 canvas。
 * 編輯模式畫角色設定；執行中畫 Runtime 的執行期角色。
 */
class Stage {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.fancy = FancyRenderer.create(canvas);
    this.fancyMode = false;
  }

  /** 舞台座標 → canvas 像素座標 */
  toPx(x, y) { return [x + STAGE_W / 2, STAGE_H / 2 - y]; }
  /** canvas 像素座標 → 舞台座標 */
  toStage(px, py) { return [px - STAGE_W / 2, STAGE_H / 2 - py]; }

  /**
   * 繪製一個畫格
   * @param {Array} sprites 角色（config 或 RuntimeSprite 皆可）
   * @param {Object} vars 變數表（左上角顯示）
   * @param {string|null} selectedId 編輯模式中選取角色的外框
   */
  render(sprites, vars, selectedId) {
    // 帥氣模式：執行中（selectedId 為 null）走特效渲染
    if (this.fancyMode && !selectedId) {
      this.fancy.render(sprites, vars, this.toPx.bind(this));
      return;
    }

    const ctx = this.ctx;
    ctx.clearRect(0, 0, STAGE_W, STAGE_H);

    for (const s of sprites) {
      if (!s.visible) continue;
      const [px, py] = this.toPx(s.x, s.y);
      const fontSize = SPRITE_BASE_SIZE * (s.size / 100);

      ctx.save();
      ctx.translate(px, py);
      ctx.rotate((s.dir - 90) * Math.PI / 180);
      const costumeImg = getCostumeImage(s.costume);
      if (costumeImg) {
        const drawSize = fontSize * 1.2;
        ctx.drawImage(costumeImg, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
      } else {
        ctx.font = `${fontSize}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(s.costume, 0, 0);
      }
      ctx.restore();

      // 編輯模式：選取角色畫虛線框
      if (selectedId && s.id === selectedId) {
        ctx.save();
        ctx.strokeStyle = '#4c97ff';
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(px - fontSize / 2 - 4, py - fontSize / 2 - 4, fontSize + 8, fontSize + 8);
        ctx.restore();
      }

      // 對話泡泡
      if (s.sayText) this.drawBubble(px, py - fontSize / 2 - 8, s.sayText);
    }

    // 變數顯示（左上角橘色標籤）
    let vy = 8;
    for (const [name, val] of Object.entries(vars || {})) {
      const label = `${name}：${val}`;
      const ctx2 = this.ctx;
      ctx2.font = '12px sans-serif';
      const w = ctx2.measureText(label).width + 16;
      ctx2.fillStyle = '#ff8c1a';
      roundRect(ctx2, 8, vy, w, 20, 6);
      ctx2.fill();
      ctx2.fillStyle = '#fff';
      ctx2.fillText(label, 16, vy + 14);
      vy += 26;
    }
  }

  /** 對話泡泡（白底圓角框 + 小尾巴） */
  drawBubble(px, py, text) {
    const ctx = this.ctx;
    ctx.font = '13px sans-serif';
    const w = Math.min(200, ctx.measureText(text).width + 18);
    const h = 26;
    let bx = clamp(px - w / 2, 2, STAGE_W - w - 2);
    let by = Math.max(2, py - h - 8);
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#b3c7e6';
    roundRect(ctx, bx, by, w, h, 8);
    ctx.fill(); ctx.stroke();
    // 小尾巴
    ctx.beginPath();
    ctx.moveTo(px - 4, by + h); ctx.lineTo(px + 4, by + h); ctx.lineTo(px, by + h + 7);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#333';
    ctx.fillText(text, bx + 9, by + 17, w - 18);
    ctx.restore();
  }

  /** 命中測試：回傳該像素座標最上層（陣列最後）的角色 */
  hitTest(sprites, px, py) {
    const [sx, sy] = this.toStage(px, py);
    for (let i = sprites.length - 1; i >= 0; i--) {
      const s = sprites[i];
      if (!s.visible) continue;
      const half = SPRITE_BASE_SIZE * (s.size / 100) * 0.5;
      if (Math.abs(sx - s.x) <= half && Math.abs(sy - s.y) <= half) return s;
    }
    return null;
  }
}

/** 圓角矩形路徑 */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
