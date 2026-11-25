// 真实 Chrome 基准；固定卡图响应，隔离第三方 CDN 波动。
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const base = process.env.PERF_URL || 'http://127.0.0.1:8000';
const viewportWidth = Number(process.env.PERF_WIDTH || 1440);
const cpuRate = Number(process.env.PERF_CPU_RATE || 1);
const output = process.argv[2] || 'docs/report/browser-performance.json';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a+XcAAAAASUVORK5CYII=', 'base64');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true
  });
  const report = { date: new Date().toISOString(), browser: browser.version(), imagePolicy: '固定 1px 图片，排除外部 CDN 耗时', viewportWidth, cpuRate, runs: [] };
  try {
    for (let run = 0; run < 3; run++) {
      const context = await browser.newContext({ viewport: { width: viewportWidth, height: 900 } });
      await context.route('**/*', route => {
        if (route.request().resourceType() !== 'image' && new URL(route.request().url()).origin === new URL(base).origin) return route.continue();
        return route.fulfill({ contentType: 'image/png', body: png });
      });
      const page = await context.newPage();
      const session = await context.newCDPSession(page);
      await session.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => {
        window.__perf = { longTasks: [] };
        new PerformanceObserver(list => {
          window.__perf.longTasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration })));
        }).observe({ type: 'longtask', buffered: true });
        new MutationObserver((_, observer) => {
          if (document.querySelector('.card-tile')) {
            requestAnimationFrame(() => { window.__perf.readyMs = performance.now(); });
            observer.disconnect();
          }
        }).observe(document, { childList: true, subtree: true });
      });
      await page.goto(base, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__perf.readyMs > 0);
      const first = await page.evaluate(() => ({
        readyMs: window.__perf.readyMs,
        fcpMs: performance.getEntriesByName('first-contentful-paint')[0]?.startTime,
        localTransferBytes: performance.getEntriesByType('resource').filter(e => e.name.startsWith(location.origin) && !e.name.includes('/thumbnails/')).reduce((n, e) => n + e.transferSize, 0),
        longTasks: window.__perf.longTasks
      }));
      await page.waitForFunction(() => !document.getElementById('searchInput').disabled);
      const start = performance.now();
      await page.locator('#searchInput').fill('皮卡丘');
      await page.waitForFunction(() => document.getElementById('resultText').textContent.includes('429'));
      const searchMs = performance.now() - start;
      await page.locator('#clearSearch').click();
      await page.waitForFunction(() => document.getElementById('resultText').textContent.includes('24,544'));
      const moreTimes = [];
      for (let i = 0; i < 50; i++) {
        moreTimes.push(await page.evaluate(() => {
          const start = performance.now();
          document.getElementById('loadMore').click();
          return new Promise(resolve => requestAnimationFrame(() => resolve(performance.now() - start)));
        }));
      }
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight - 1000));
      await page.waitForTimeout(100);
      const cdp = await context.newCDPSession(page);
      await cdp.send('HeapProfiler.collectGarbage');
      const heap = await cdp.send('Runtime.getHeapUsage');
      const dom = await cdp.send('Memory.getDOMCounters');
      const final = await page.evaluate(() => ({
        renderedCards: document.querySelectorAll('.card-tile').length,
        result: document.getElementById('resultText').textContent,
        totalLongTasks: window.__perf.longTasks.length,
        longestTaskMs: Math.max(0, ...window.__perf.longTasks.map(e => e.duration))
      }));
      if (process.env.PERF_CHECK === '1') {
        assert.equal(errors.length, 0);
        assert.ok(final.renderedCards <= 80, '虚拟窗口卡片数超过 80');
        assert.ok(dom.nodes < 6000, 'DOM 节点超过 6000');
        assert.ok(dom.jsEventListeners < 300, '监听器超过 300');
        assert.ok(first.localTransferBytes < 1500000, '首屏本地传输超过 1.5 MB');
        assert.ok(moreTimes[25] < 50 * cpuRate, '加载更多中位耗时超过预算');
      }
      report.runs.push({ first, searchMs, loadMoreMedianMs: moreTimes.sort((a, b) => a - b)[25], loadMoreMaxMs: Math.max(...moreTimes), heapBytes: heap.usedSize, dom, final, errors });
      await context.close();
    }
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
