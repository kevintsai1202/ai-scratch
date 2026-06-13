/**
 * e2e/feature.test.mjs — 手機播放模式 ＋ 兒童闖關教學 驗證（可重跑）
 *
 * 驗證項目：
 *   A. 桌機首次開啟 → 教學自動出現，可逐關前進、✨幫手能代放積木、過關條件生效
 *   B. 手機（iPhone 模擬）開分享連結 → 進播放模式、舞台縮放、虛擬按鍵出現且可控制角色
 *
 * 執行方式：node e2e/feature.test.mjs
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5186;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript' };
const server = http.createServer(async (req, res) => {
  try {
    const file = join(ROOT, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${PORT}/`;

let passed = 0;
function assert(cond, msg) {
  if (!cond) throw new Error(`❌ 斷言失敗：${msg}`);
  passed++;
  console.log(`✅ ${msg}`);
}

const browser = await chromium.launch();
const errors = [];
const watch = (page) => {
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
};

try {
  /* ════ A. 兒童闖關教學（桌機、全新使用者） ════ */
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 } });
  const page = await ctx.newPage();
  watch(page);
  await page.goto(BASE);
  await page.waitForSelector('.blocklySvg');

  await page.waitForSelector('#tutorialCard', { timeout: 8000 });
  assert(true, '首次開啟自動出現教學卡');
  // 注音 ruby 會讓 textContent 夾雜注音符號，先濾掉再比對
  const titleText = (await page.textContent('.tut-title')).replace(/[ㄅ-ㄩˊˇˋ˙]/g, '');
  assert(titleText.includes('積木小精靈'), '歡迎關卡文案正確');

  // 歡迎 → 積木箱 → 舞台（無過關條件的關卡，下一步直接可按）
  await page.click('.tut-next'); // → 認識積木箱
  assert(await page.locator('#tutorialSpot').isVisible(), '聚光燈高亮目標元件');
  await page.click('.tut-next'); // → 認識舞台
  await page.click('.tut-next'); // → 第 1 關：放積木

  // 第 1 關：尚未放積木時「下一步」應該是灰的
  assert(await page.locator('.tut-next').isDisabled(), '未達成條件時「下一步」鎖定');
  await page.click('.tut-help'); // ✨ 幫我放積木
  await page.waitForSelector('.tut-next:not([disabled])', { timeout: 5000 });
  assert(true, '✨幫手放積木後過關條件達成');
  await page.click('.tut-next'); // → 按 ▶

  await page.click('#btnRun');
  await page.waitForSelector('.tut-next:not([disabled])', { timeout: 5000 });
  assert(true, '按 ▶ 後偵測到角色移動，過關');
  await page.click('.tut-next'); // → 第 2 關：鍵盤

  await page.click('.tut-help');
  await page.waitForSelector('.tut-next:not([disabled])');
  await page.click('.tut-next'); // → 第 3 關：新增角色
  await page.click('.tut-help');
  await page.waitForSelector('.tut-next:not([disabled])');
  const spriteCount = await page.evaluate(() => App.project.sprites.length);
  assert(spriteCount === 2, '✨幫手變出蘋果角色');
  await page.click('.tut-next'); // → 第 4 關：蘋果魔法
  await page.click('.tut-help');
  await page.waitForSelector('.tut-next:not([disabled])');
  assert(true, '蘋果魔法積木已注入');
  await page.click('.tut-next'); // → 第 5 關：玩遊戲
  await page.click('#btnRun');
  await page.waitForSelector('.tut-next:not([disabled])', { timeout: 5000 });
  assert(true, '遊戲執行且「分數」變數建立，最終關過關');
  await page.click('.tut-next'); // → 畢業
  await page.click('.tut-next'); // 完成 🎉
  assert(await page.evaluate(() => localStorage.getItem('scratchy.tutorialDone')) === '1',
    '完成教學後寫入已完成旗標');
  assert(await page.locator('#tutorialCard').count() === 0, '教學圖層已關閉');

  // 🎓 按鈕可重新開始教學
  await page.click('#btnTutorial');
  assert(await page.locator('#tutorialCard').isVisible(), '🎓 按鈕可重看教學');
  await page.click('.tut-skip');

  // 產生分享連結給手機測試用（此時作品已是「貓咪接蘋果」）
  await page.waitForTimeout(700); // 等 autosave
  const shareUrl = await page.evaluate(() => Storage.shareUrl(App.project));

  /* ════ B. 手機播放模式（iPhone 模擬） ════ */
  const mctx = await browser.newContext({ ...devices['iPhone 13'] });
  const mpage = await mctx.newPage();
  watch(mpage);
  await mpage.goto(shareUrl.replace(/^https?:\/\/[^/]+\//, BASE));
  await mpage.waitForSelector('#playOverlay.active', { timeout: 15000 });
  assert(true, '手機開分享連結進入播放模式');

  const transform = await mpage.evaluate(() => document.getElementById('stageWrap').style.transform);
  assert(/scale\(/.test(transform), `舞台已依螢幕縮放（${transform}）`);
  assert(await mpage.locator('#gamepad').isVisible(), '虛擬按鍵已顯示');
  assert(await mpage.locator('#tutorialCard').count() === 0, '播放模式不會跳教學');

  await mpage.tap('#btnPlayBig');
  await mpage.waitForTimeout(500);
  const x0 = await mpage.evaluate(() => App.runtime?.sprites[0]?.x);
  await mpage.tap('.pad-right');
  await mpage.waitForTimeout(400);
  const x1 = await mpage.evaluate(() => App.runtime?.sprites[0]?.x);
  assert(x1 > x0, `虛擬 → 鍵能控制角色（x: ${x0} → ${x1}）`);

  /* ════ 全程無錯誤 ════ */
  const realErrors = errors.filter(e => !/favicon/.test(e));
  assert(realErrors.length === 0, `無 console / page 錯誤${realErrors.length ? '：\n' + realErrors.join('\n') : ''}`);

  console.log(`\n🎉 全部 ${passed} 項驗證通過`);
} finally {
  await browser.close();
  server.close();
}
