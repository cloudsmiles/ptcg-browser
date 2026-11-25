const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const base = process.env.PERF_URL || 'http://127.0.0.1:8000';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a+XcAAAAASUVORK5CYII=', 'base64');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    for (const ratio of [1, 2]) {
      const page = await browser.newPage({ deviceScaleFactor: ratio, viewport: { width: 1440, height: 900 } });
      await page.route('**/*', route => route.request().resourceType() === 'image'
        ? route.fulfill({ contentType: 'image/png', body: png }) : route.continue());
      await page.goto(base);
      await page.waitForSelector('.card-tile .real-img.loaded');
      const current = await page.locator('.card-tile .real-img').first().evaluate(img => img.currentSrc);
      assert.ok(current.includes('/thumbnails/'));
      assert.ok(current.includes(ratio === 1 ? '/240/' : '/480/'));
      await page.locator('.card-tile').first().click();
      await page.waitForSelector('#mainImage.loaded');
      const detail = await page.locator('#mainImage').evaluate(img => img.currentSrc);
      assert.ok(detail.startsWith('https://cdn.jsdelivr.net/'));
      console.log(`PASS DPR ${ratio}：列表自动选择缩略图，详情使用原图`);
      await page.close();
    }
    const page = await browser.newPage();
    await page.route('**/thumbnails/**', route => route.fulfill({ status: 502, body: 'unavailable' }));
    await page.route('https://**/*', route => route.fulfill({ contentType: 'image/png', body: png }));
    await page.goto(base);
    await page.waitForSelector('.card-tile .real-img.loaded');
    const image = await page.locator('.card-tile .real-img').first().evaluate(img => ({ src: img.currentSrc, srcset: img.getAttribute('srcset') }));
    assert.ok(image.src.startsWith('https://cdn.jsdelivr.net/'));
    assert.equal(image.srcset, null);
    console.log('PASS 缩略图失败自动回退原图，清除 srcset 避免重复失败');
    await page.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
