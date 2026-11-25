// 捕获虚拟滚动时可见节点被移除、重复入场动画及卡片位置跳动。
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true
  });
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.route('**/*', route => route.request().resourceType() === 'image' ? route.abort() : route.continue());
      await page.goto(process.env.PERF_URL || 'http://127.0.0.1:8000');
      await page.waitForSelector('.card-tile');
      await page.waitForFunction(() => !document.getElementById('searchInput').disabled);
      await page.evaluate(() => {
        for (let i = 0; i < 10; i++) document.getElementById('loadMore').click();
        window.scrollTo({ top: 1200, behavior: 'instant' });
      });
      await page.waitForTimeout(500);
      const result = await page.evaluate(async () => {
        const grid = document.getElementById('cardGrid');
        const anchor = Array.from(grid.children).find(tile => {
          const rect = tile.getBoundingClientRect();
          return rect.top > 100 && rect.bottom < innerHeight - 50;
        });
        const before = anchor.getBoundingClientRect().top + scrollY;
        let removals = 0;
        const observer = new MutationObserver(records => {
          for (const record of records) {
            for (const node of record.removedNodes) if (node === anchor) removals++;
          }
        });
        observer.observe(grid, { childList: true });
        let animations = 0;
        for (let i = 0; i < 12; i++) {
          window.scrollBy({ top: 10, behavior: 'instant' });
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          animations += grid.getAnimations({ subtree: true }).filter(a => a.animationName === 'fadeIn').length;
        }
        observer.disconnect();
        return {
          removals, animations,
          sameNode: grid.querySelector('[data-index="' + anchor.dataset.index + '"]') === anchor,
          documentPositionDrift: Math.abs(anchor.getBoundingClientRect().top + scrollY - before)
        };
      });
      assert.equal(result.removals, 0, `${width}px 滚动中可见卡片被反复移出 DOM`);
      assert.equal(result.animations, 0, `${width}px 滚动中重新触发入场动画`);
      assert.equal(result.sameNode, true);
      assert.ok(result.documentPositionDrift < 2, `${width}px 卡片布局跳动 ${result.documentPositionDrift}px`);
      console.log(`PASS ${width}px 滚动稳定性：${JSON.stringify(result)}`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
