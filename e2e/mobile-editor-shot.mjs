/**
 * e2e/mobile-editor-shot.mjs — 手機「編輯模式」診斷截圖
 * 拍：初始畫面、點開工具箱分類（flyout）、捲到舞台區
 * 執行方式：node e2e/mobile-editor-shot.mjs
 */
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'e2e', 'shots');
await mkdir(OUT, { recursive: true });
const PORT = 5194;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript' };
const server = http.createServer(async (req, res) => {
  try {
    const file = join(ROOT, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
await ctx.addInitScript(() => localStorage.setItem('scratchy.tutorialDone', '1'));
const page = await ctx.newPage();
page.on('pageerror', e => console.log('[頁面錯誤]', e.message));
await page.goto(`http://127.0.0.1:${PORT}/`);
await page.waitForSelector('.blocklySvg');
await page.waitForTimeout(600);
await page.screenshot({ path: join(OUT, 'mobile-editor-1-top.png'), fullPage: false });

// 點第一個工具箱分類看 flyout
await page.tap('.blocklyToolboxCategory');
await page.waitForTimeout(600);
await page.screenshot({ path: join(OUT, 'mobile-editor-2-flyout.png') });

// 捲到底看舞台與角色面板
await page.evaluate(() => document.querySelector('aside')?.scrollIntoView({ block: 'start' }));
await page.waitForTimeout(400);
await page.screenshot({ path: join(OUT, 'mobile-editor-3-stage.png') });

console.log('截圖完成：e2e/shots/mobile-editor-{1-top,2-flyout,3-stage}.png');
await browser.close();
server.close();
