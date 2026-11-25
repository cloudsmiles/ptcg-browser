// 桌面/手机的真实 Chrome 回归与性能预算检查。
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const base = process.env.PERF_URL || 'http://127.0.0.1:8000';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a+XcAAAAASUVORK5CYII=', 'base64');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const errors = [];
      await context.route('**/*', route => route.request().resourceType() !== 'image' && new URL(route.request().url()).origin === new URL(base).origin
        ? route.continue() : route.fulfill({ contentType: 'image/png', body: png }));
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(base);
      await page.waitForSelector('.card-tile');
      await page.waitForFunction(() => !document.getElementById('searchInput').disabled);
      assert.ok(await page.locator('.card-tile').count() <= 80);
      // 索引初始化时不下载详情。
      assert.equal(await page.evaluate(() => performance.getEntriesByType('resource').filter(e => e.name.includes('/zh-details/')).length), 0);
      await page.locator('#searchInput').fill('皮卡丘');
      await page.waitForFunction(() => document.getElementById('resultText').textContent.includes('429'));
      await page.locator('.card-tile').first().click();
      await page.waitForSelector('#modalTitle');
      assert.ok((await page.locator('#modalTitle').textContent()).includes('皮卡丘'));
      await page.locator('#modalClose').click();
      await page.locator('#searchInput').fill('不可能存在的卡牌字符串');
      await page.waitForSelector('#emptyState:visible');
      await page.locator('#emptyReset').click();
      await page.waitForFunction(() => document.getElementById('resultText').textContent.includes('24,544'));
      await page.evaluate(() => { for (let i = 0; i < 50; i++) document.getElementById('loadMore').click(); });
      // 保证跳到底部后渲染正确的记录，而不是首屏卡片。
      await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
      await page.waitForFunction(() => document.querySelector('.card-tile[data-index="2447"]'));
      assert.ok(await page.locator('.card-tile').count() <= 80);
      const lastName = await page.locator('.card-tile[data-index="2447"] .card-name').textContent();
      await page.locator('.card-tile[data-index="2447"]').click();
      await page.waitForSelector('#modalTitle');
      assert.equal(await page.locator('#modalTitle').textContent(), lastName);
      await page.locator('#modalClose').click();
      // 同一页面宽度变化后仍能定位尾部，且没有横向溢出。
      await page.setViewportSize({ width: width === 390 ? 1440 : 390, height: 900 });
      // 等待 resize 引发的布局与虚拟列表更新，再按新的页面高度滚动。
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
      await page.waitForFunction(() => document.querySelector('.card-tile[data-index="2447"]'));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}px：首屏、搜索、空结果重置、详情、2448 张虚拟窗口、底部索引、尺寸变化`);
      await context.close();
    }
    const page = await browser.newPage();
    let pending = [];
    async function nextRequest() {
      const deadline = Date.now() + 10000;
      while (!pending.length) {
        if (Date.now() > deadline) throw new Error('10 秒内未收到详情请求');
        await page.waitForTimeout(10);
      }
      return pending.shift();
    }
    await page.route('**/zh-details/**', route => { pending.push(route); });
    await page.goto(base);
    await page.waitForSelector('.card-tile');
      await page.waitForFunction(() => !document.getElementById('searchInput').disabled);
    await page.locator('.card-tile').first().click();
    await page.waitForFunction(() => document.getElementById('modalBody').textContent.includes('正在加载'));
    await (await nextRequest()).fulfill({ status: 503, body: 'unavailable' });
    await page.locator('#retryDetail').click();
    const retryRequest = await nextRequest();
    // 关闭后返回的旧请求不得重新打开或覆盖弹窗。
    await page.locator('#modalClose').click();
    await retryRequest.continue();
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#modal').isHidden(), true);
    await page.locator('.card-tile').first().click();
    await page.waitForSelector('#modalTitle');
    console.log('PASS 详情请求失败可重试，关闭后旧响应不重新打开弹窗');
    await page.close();
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
