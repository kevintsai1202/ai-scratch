/**
 * e2e/uivoice.test.mjs — 選單注音標示＋點選語音 驗證（可重跑）
 *
 * 驗證項目：
 *   1. 工具列按鈕、工具箱分類都有注音 ruby 標示
 *   2. 點選工具箱分類／工具列按鈕會唸出對應名稱（以 UIVoice.lastSpoken 檢查）
 *   3. 🔊 開關可靜音（lastSpoken 仍記錄但不發聲——以 voice 旗標檢查 localStorage）
 *   4. 全程無 console / page 錯誤
 *
 * 執行方式：node e2e/uivoice.test.mjs
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5188;
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
const ctx = await browser.newContext();
await ctx.addInitScript(() => localStorage.setItem('scratchy.tutorialDone', '1'));
const errors = [];

try {
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForSelector('.blocklySvg');

  // 1. 注音 ruby 標示
  const rtCount = (sel) => page.evaluate((s) =>
    [...document.querySelectorAll(`${s} .zy-rt`)].filter(e => e.textContent.trim()).length, sel);
  assert(await rtCount('header') > 0, '工具列按鈕有注音標示');
  assert(await rtCount('.blocklyToolbox') > 0, '工具箱分類有注音標示');
  const sampleRt = await page.evaluate(() =>
    [...document.querySelectorAll('.blocklyToolbox .zy-rt')].find(e => e.textContent.trim())?.textContent);
  assert(/[ㄅ-ㄩ]/.test(sampleRt), `注音內容正確（${sampleRt}）`);

  // 2. 點選唸出
  await page.click('.blocklyToolbox [data-speak]');
  const spoken1 = await page.evaluate(() => UIVoice.lastSpoken);
  assert(spoken1.length > 0, `點工具箱分類唸出「${spoken1}」`);
  await page.click('#btnSave');
  assert(await page.evaluate(() => UIVoice.lastSpoken) === '儲存', '點「儲存」唸出「儲存」');

  // 3. 🔊 開關
  await page.click('#btnVoice');
  assert(await page.evaluate(() => localStorage.getItem('scratchy.uiVoice')) === '0', '🔇 可關閉點選語音');
  await page.click('#btnVoice');
  assert(await page.evaluate(() => localStorage.getItem('scratchy.uiVoice')) === '1', '🔊 可重新開啟');

  // 4. 角色卡與教學卡也有 data-speak / 注音
  assert(await page.locator('.sprite-card[data-speak]').count() >= 1, '角色卡可點選唸出名稱');
  await page.click('#btnTutorial');
  await page.waitForSelector('#tutorialCard');
  assert(await rtCount('#tutorialCard') > 0, '教學卡文字有注音標示');
  await page.click('.tut-skip');

  const realErrors = errors.filter(e => !/favicon/.test(e));
  assert(realErrors.length === 0, `無 console / page 錯誤${realErrors.length ? '：\n' + realErrors.join('\n') : ''}`);

  console.log(`\n🎉 全部 ${passed} 項驗證通過`);
} finally {
  await browser.close();
  server.close();
}
