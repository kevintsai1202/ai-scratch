/**
 * e2e/mobile-editor.test.mjs — 手機「編輯模式」可操作性驗證（可重跑）
 *
 * 驗證項目：
 *   1. 初始畫面：header、▶⏹ 控制列、舞台都在可視範圍內（修正 column-reverse 溢出 bug）
 *   2. 點工具箱分類能展開 flyout（積木可瀏覽）
 *   3. 浮動 ▶ 鈕可執行、變 ⏹、虛擬按鍵亮出、按 → 能控制角色、⏹ 可停止
 *   4. 全程無 console / page 錯誤
 *
 * 執行方式：node e2e/mobile-editor.test.mjs
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5196;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript' };
const server = http.createServer(async (req, res) => {
  try {
    const file = join(ROOT, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

let passed = 0;
function assert(cond, msg) {
  if (!cond) throw new Error(`❌ 斷言失敗：${msg}`);
  passed++;
  console.log(`✅ ${msg}`);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
await ctx.addInitScript(() => localStorage.setItem('scratchy.tutorialDone', '1'));
const errors = [];

try {
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForSelector('.blocklySvg');
  await page.waitForTimeout(600);

  /* 1. 版面：關鍵元件都看得到 */
  const layout = await page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.top < innerHeight && r.height > 0;
    };
    return {
      scrollY,
      header: vis(document.querySelector('header')),
      stageBar: vis(document.querySelector('.stage-bar')),
      stage: vis(document.getElementById('stageWrap')),
      headerH: Math.round(document.querySelector('header').getBoundingClientRect().height),
    };
  });
  assert(layout.scrollY === 0 && layout.header, `header 在頂端可見（高 ${layout.headerH}px）`);
  assert(layout.stageBar, '▶⏹ 控制列在可視範圍內');
  assert(layout.stage, '舞台在可視範圍內');
  assert(layout.headerH < 180, `header 高度合理（${layout.headerH}px < 180px）`);

  /* 2. 工具箱可操作 */
  await page.tap('.blocklyToolboxCategory');
  // 等待：原生 Blockly touch 處理（pointerdown）+ 補丁 setTimeout(80ms)
  await page.waitForTimeout(600);
  // 注意：.blocklyFlyout 有兩個元素（toolbox 和 trashcan）；
  //       工具箱飛出面板的正確 class 是 .blocklyToolboxFlyout
  const flyoutOpen = await page.evaluate(() => {
    const ws = Blockly.getMainWorkspace();
    const flyout = ws?.getToolbox?.()?.getFlyout?.();
    return flyout?.isVisible?.() === true ||
      (document.querySelector('.blocklyToolboxFlyout')?.getBoundingClientRect().width ?? 0) > 0;
  });
  assert(flyoutOpen, '點分類能展開積木清單（flyout）');

  /* 3. 注入鍵盤控制積木 → 浮動鈕執行 → 虛擬按鍵操作 */
  await page.evaluate(() => {
    Blockly.serialization.workspaces.load({ blocks: { languageVersion: 0, blocks: [
      { type: 'event_whenkey', x: 20, y: 20, fields: { KEY: 'ArrowRight' },
        inputs: { DO: { block: {
          type: 'motion_change_x',
          inputs: { DX: { shadow: { type: 'math_number', fields: { NUM: 15 } } } } } } } },
    ] } }, Blockly.getMainWorkspace());
  });
  assert(await page.locator('#fabRun').isVisible(), '浮動 ▶ 執行鈕可見');
  await page.tap('#fabRun');
  await page.waitForTimeout(400);
  assert(await page.evaluate(() => !!App.runtime), '浮動鈕可啟動執行');
  assert((await page.textContent('#fabRun')).includes('⏹'), '執行中浮動鈕變 ⏹');
  assert(await page.locator('#gamepad').isVisible(), '編輯模式執行中虛擬按鍵亮出');

  const x0 = await page.evaluate(() => App.runtime.sprites[0].x);
  await page.tap('.pad-right');
  await page.waitForTimeout(300);
  const x1 = await page.evaluate(() => App.runtime.sprites[0].x);
  assert(x1 > x0, `虛擬 → 鍵能控制角色（x: ${x0} → ${x1}）`);

  await page.tap('#fabRun');
  await page.waitForTimeout(200);
  assert(await page.evaluate(() => !App.runtime), '浮動 ⏹ 可停止執行');
  assert(!(await page.locator('#gamepad').isVisible()), '停止後虛擬按鍵收起');

  /* 4. 無錯誤 */
  const realErrors = errors.filter(e => !/favicon/.test(e));
  assert(realErrors.length === 0, `無 console / page 錯誤${realErrors.length ? '：\n' + realErrors.join('\n') : ''}`);

  console.log(`\n🎉 全部 ${passed} 項驗證通過`);
} finally {
  await browser.close();
  server.close();
}
