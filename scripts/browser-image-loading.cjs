// 卡图下载尚未结束时，不显示替代文字卡面或浮层文字。
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    const page = await browser.newPage();
    let releaseImages;
    const gate = new Promise(resolve => { releaseImages = resolve; });
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a+XcAAAAASUVORK5CYII=', 'base64');
    await page.route('**/*', async route => {
      if (route.request().resourceType() !== 'image') return route.continue();
      await gate;
      await route.fulfill({ contentType: 'image/png', body: png });
    });
    await page.goto(process.env.PERF_URL || 'http://127.0.0.1:8000', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.card-tile');
    const result = await page.locator('.card-tile').first().evaluate(tile => {
      const art = tile.querySelector('.card-art');
      const badge = art.querySelector('.set-badge');
      return { textFaces: art.querySelectorAll('.card-face').length, badgeVisible: getComputedStyle(badge).visibility !== 'hidden' && getComputedStyle(badge).display !== 'none', name: tile.querySelector('.card-name').textContent };
    });
    assert.equal(result.textFaces, 0, '加载期间不应显示文字卡面');
    assert.equal(result.badgeVisible, false, '加载期间不应露出系列浮层');
    assert.ok(result.name.length > 0, '卡图下方卡名仍应可用');
    releaseImages();
    await page.waitForSelector('.card-tile .real-img.loaded');
    assert.equal(await page.locator('.card-tile .set-badge').first().evaluate(badge => getComputedStyle(badge).visibility), 'visible');
    await page.close();
    console.log('PASS 图片加载期间无替代文字和系列浮层，卡名保留，加载成功后图片与系列正常显示');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
