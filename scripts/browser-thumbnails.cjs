const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const base = process.env.PERF_URL || 'http://127.0.0.1:8000';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAwCAIAAAD/zu84AAAASElEQVR4nO3RMRHAMAwEQTsIAiX8OZhTIJwbdbsAXjOnfb53TXpG15cDF/wgSZQkShIliZJESaIkUZIoSZQkShIliZJEaTzRD5eNAW2oGotWAAAAAElFTkSuQmCC', 'base64');
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
      assert.ok(detail.includes('/thumbnails/v2/') && detail.includes('/960/'));
      console.log(`PASS DPR ${ratio}：列表自动选择缩略图，详情使用压缩 WebP`);
      await page.close();
    }
    const page = await browser.newPage();
    const originalRequests = [];
    page.on('request', request => { if (request.url().includes('/originals/')) originalRequests.push(request.url()); });
    await page.route('**/thumbnails/**', route => route.fulfill({ status: 502, body: 'unavailable' }));
    await page.goto(base);
    await page.waitForTimeout(600);
    assert.equal(await page.locator('.card-tile .real-img.loaded').count(), 0);
    assert.deepEqual(originalRequests, []);
    assert.ok(await page.locator('.image-status').first().textContent());
    console.log('PASS 列表缩略图失败保留提示，不请求原图');
    await page.close();
    const pendingPage = await browser.newPage();
    const attempts = new Map();
    const forbidden = [];
    pendingPage.on('request', request => { if (request.url().includes('/originals/') || request.url().includes('/960/')) forbidden.push(request.url()); });
    await pendingPage.route('**/thumbnails/**', route => {
      const key = route.request().url().split('?')[0];
      const count = (attempts.get(key) || 0) + 1;
      attempts.set(key, count);
      return count <= 2
        ? route.fulfill({ status: 202, headers: { 'Cache-Control': 'no-store', 'Retry-After': '2' },
          contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="1"></svg>' })
        : route.fulfill({ contentType: 'image/png', body: png });
    });
    await pendingPage.goto(base);
    const first = pendingPage.locator('.card-tile .real-img').first();
    await pendingPage.waitForFunction(() => {
      const image = document.querySelector('.card-tile .real-img');
      return image && image.naturalWidth > image.naturalHeight * 10;
    });
    assert.equal(await first.evaluate(img => img.classList.contains('loaded')), false);
    await pendingPage.waitForFunction(() => {
      const image = document.querySelector('.card-tile .real-img');
      return image && image.classList.contains('loaded');
    });
    const ready = await first.evaluate(img => ({ src: img.currentSrc, width: img.naturalWidth }));
    assert.ok(ready.width > 0 && ready.width <= 32);
    assert.equal(attempts.get(ready.src.split('?')[0]), 3);
    assert.ok(ready.src.includes('/thumbnails/v2/'));
    assert.deepEqual(forbidden, []);
    console.log('PASS 缩略图两次处理中后自动重试成功，列表始终不请求原图或详情图');
    await pendingPage.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
