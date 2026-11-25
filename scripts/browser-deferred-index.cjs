// 完整索引阻塞或失败时，首屏仍可展示；后台完成后才开放全量查询。
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    const page = await browser.newPage();
    let pending;
    await page.route(/\/data\/zh-index(?:\/[^/]+)?\.js$/, route => { pending = route; });
    await page.route('**/thumbnails/**', route => route.abort());
    await page.route('https://**/*', route => route.abort());
    await page.goto(process.env.PERF_URL || 'http://127.0.0.1:8000', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.card-tile', { timeout: 5000 });
    assert.equal(await page.locator('#searchInput').isDisabled(), true);
    assert.ok((await page.locator('#resultText').textContent()).includes('48'));
    assert.equal(await page.evaluate(() => window.PTCG_LANG_DATA.zh.cards.length), 48);
    const deadline = Date.now() + 10000;
    while (!pending) { if (Date.now() > deadline) throw new Error('未触发后台索引请求'); await page.waitForTimeout(20); }
    await pending.fulfill({ status: 503, body: 'unavailable' });
    pending = null;
    await page.locator('#retryIndex').click();
    const retryDeadline = Date.now() + 10000;
    while (!pending) { if (Date.now() > retryDeadline) throw new Error('未重试'); await page.waitForTimeout(20); }
    await pending.continue();
    await page.waitForFunction(() => !document.getElementById('searchInput').disabled);
    assert.equal(await page.evaluate(() => window.PTCG_LANG_DATA.zh.cards.length), 24544);
    await page.locator('#searchInput').fill('皮卡丘');
    await page.waitForFunction(() => document.getElementById('resultText').textContent.includes('429'));
    console.log('PASS 完整索引阻塞时首屏可展示，失败可重试，完成后全量搜索正确');
    await page.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
