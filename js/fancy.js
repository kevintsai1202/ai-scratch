/**
 * fancy.js — 帥氣模式渲染器
 *
 * 執行時為舞台加入 2.5D 特效：漸層天空、透視地板、角色光暈陰影、
 * 移動殘影、得分飛字、分身爆裂粒子。
 */
const FancyRenderer = (() => {
  'use strict';

  const DUST_COUNT = 18;
  const TRAIL_MAX = 5;

  /** 建立帥氣渲染器實例 */
  function create(canvas) {
    const ctx = canvas.getContext('2d');

    /** 浮塵粒子 */
    const dust = Array.from({ length: DUST_COUNT }, () => ({
      x: Math.random() * STAGE_W, y: Math.random() * STAGE_H,
      vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.2,
      r: 1 + Math.random() * 2, alpha: 0.1 + Math.random() * 0.15,
    }));

    const effects = [];
    const trails = new Map();
    let prevVars = {};

    /** 漸層天空背景 */
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
      for (let i = 0; i < 12; i++) {
        const t = i / 12;
        const y = horizon + (STAGE_H - horizon) * (t * t);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(STAGE_W, y); ctx.stroke();
      }
      const cx = STAGE_W / 2;
      for (let i = -6; i <= 6; i++) {
        ctx.beginPath(); ctx.moveTo(cx + i * 12, horizon); ctx.lineTo(cx + i * 50, STAGE_H); ctx.stroke();
      }
      ctx.restore();
    }

    /** 更新並繪製浮塵粒子 */
    function drawDust() {
      ctx.save();
      for (const p of dust) {
        p.x += p.vx; p.y += p.vy + Math.sin(p.x * 0.01) * 0.1;
        if (p.x < 0) p.x = STAGE_W; if (p.x > STAGE_W) p.x = 0;
        if (p.y < 0) p.y = STAGE_H; if (p.y > STAGE_H) p.y = 0;
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = '#aaccff';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    /** 帥氣版角色繪製（投射陰影 + 外發光暈 + 放大 emoji） */
    function drawFancySprite(s, toPx) {
      if (!s.visible) return;
      const [px, py] = toPx(s.x, s.y);
      const fontSize = SPRITE_BASE_SIZE * (s.size / 100) * 1.2;
      const half = fontSize / 2;

      ctx.save();
      ctx.globalAlpha = 0.25; ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(px, py + half + 4, half * 0.7, half * 0.2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.shadowColor = '#4c97ff'; ctx.shadowBlur = 18;
      ctx.translate(px, py);
      ctx.rotate((s.dir - 90) * Math.PI / 180);
      ctx.font = `${fontSize}px serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(s.costume, 0, 0);
      ctx.restore();

      if (s.sayText) drawFancyBubble(px, py - half - 12, s.sayText);
    }

    /** 升級版對話泡泡（漸層背景 + 投影） */
    function drawFancyBubble(px, py, text) {
      ctx.save();
      ctx.font = 'bold 14px sans-serif';
      const w = Math.min(200, ctx.measureText(text).width + 22);
      const h = 30;
      const bx = clamp(px - w / 2, 2, STAGE_W - w - 2);
      const by = Math.max(2, py - h - 8);
      ctx.shadowColor = 'rgba(0,0,0,0.2)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
      const grad = ctx.createLinearGradient(bx, by, bx, by + h);
      grad.addColorStop(0, '#ffffff'); grad.addColorStop(1, '#e8f0ff');
      ctx.fillStyle = grad;
      roundRect(ctx, bx, by, w, h, 10); ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = '#88aadd'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(px - 5, by + h); ctx.lineTo(px + 5, by + h); ctx.lineTo(px, by + h + 8);
      ctx.closePath(); ctx.fillStyle = '#e8f0ff'; ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#1a2a4a';
      ctx.fillText(text, bx + 11, by + 20, w - 22);
      ctx.restore();
    }

    /** 記錄角色位置並繪製移動殘影 */
    function drawTrails(sprites, toPx) {
      for (const s of sprites) {
        if (!s.visible) continue;
        const key = s.id + (s.isClone ? '_c' + sprites.indexOf(s) : '');
        if (!trails.has(key)) trails.set(key, []);
        const trail = trails.get(key);
        const last = trail[trail.length - 1];
        if (!last || Math.abs(last.x - s.x) > 0.5 || Math.abs(last.y - s.y) > 0.5) {
          trail.push({ x: s.x, y: s.y, dir: s.dir, costume: s.costume, size: s.size });
          if (trail.length > TRAIL_MAX) trail.shift();
        }
        if (trail.length > 1) {
          ctx.save();
          for (let i = 0; i < trail.length - 1; i++) {
            const t = trail[i];
            ctx.globalAlpha = (i + 1) / (trail.length + 1) * 0.3;
            const [tpx, tpy] = toPx(t.x, t.y);
            const fs = SPRITE_BASE_SIZE * (t.size / 100) * 1.2;
            ctx.save();
            ctx.translate(tpx, tpy); ctx.rotate((t.dir - 90) * Math.PI / 180);
            ctx.font = `${fs}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(t.costume, 0, 0);
            ctx.restore();
          }
          ctx.restore();
        }
      }
    }

    /** 新增效果到佇列 */
    function addEffect(effect) { effects.push({ ...effect, frame: 0 }); }

    /** 偵測變數值增加並產生飛字效果 */
    function detectScoreChanges(vars) {
      for (const [name, val] of Object.entries(vars || {})) {
        const prev = prevVars[name];
        if (prev !== undefined && typeof val === 'number' && typeof prev === 'number' && val > prev) {
          addEffect({ type: 'scorePopup', x: 60, y: 20, text: `+${val - prev}`, maxFrame: 40 });
        }
      }
      prevVars = { ...vars };
    }

    /** 繪製並更新效果佇列（飛字、粒子爆裂、碰撞閃光） */
    function drawEffects() {
      for (let i = effects.length - 1; i >= 0; i--) {
        const e = effects[i];
        e.frame++;
        if (e.frame > e.maxFrame) { effects.splice(i, 1); continue; }
        const progress = e.frame / e.maxFrame;
        if (e.type === 'scorePopup') {
          ctx.save();
          ctx.globalAlpha = 1 - progress; ctx.fillStyle = '#ffdd00';
          ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText(e.text, e.x, e.y - progress * 30);
          ctx.restore();
        } else if (e.type === 'cloneBurst') {
          ctx.save();
          for (const p of e.particles) {
            ctx.globalAlpha = (1 - progress) * 0.7; ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(e.x + p.vx * e.frame * 2, e.y + p.vy * e.frame * 2, 3 * (1 - progress), 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        } else if (e.type === 'collisionFlash') {
          ctx.save();
          ctx.globalAlpha = (1 - progress) * 0.8;
          const r = 15 + progress * 20;
          const grad = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r);
          grad.addColorStop(0, '#ffffff'); grad.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(e.x, e.y, r, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
      }
    }

    /** 帥氣版變數顯示（漸層橘色標籤） */
    function drawFancyVars(vars) {
      let vy = 10;
      ctx.save();
      for (const [name, val] of Object.entries(vars || {})) {
        const label = `${name}：${val}`;
        ctx.font = 'bold 13px sans-serif';
        const w = ctx.measureText(label).width + 20;
        ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 6;
        const grad = ctx.createLinearGradient(8, vy, 8, vy + 24);
        grad.addColorStop(0, '#ff9933'); grad.addColorStop(1, '#ff6600');
        ctx.fillStyle = grad; roundRect(ctx, 8, vy, w, 24, 8); ctx.fill();
        ctx.shadowColor = 'transparent'; ctx.fillStyle = '#fff';
        ctx.fillText(label, 18, vy + 17);
        vy += 30;
      }
      ctx.restore();
    }

    /** 帥氣模式主繪製函式（完整一幀） */
    function render(sprites, vars, toPx) {
      ctx.clearRect(0, 0, STAGE_W, STAGE_H);
      drawSky(); drawGrid(); drawDust();
      drawTrails(sprites, toPx);
      for (const s of sprites) drawFancySprite(s, toPx);
      detectScoreChanges(vars);
      drawFancyVars(vars);
      drawEffects();
    }

    /** 重設所有狀態（新一輪執行時呼叫） */
    function reset() { effects.length = 0; trails.clear(); prevVars = {}; }

    return { render, addEffect, reset };
  }

  return { create };
})();
