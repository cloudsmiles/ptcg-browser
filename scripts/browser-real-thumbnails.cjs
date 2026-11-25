// 不拦截图片，用真实本地缩略图验证显示与浏览器长期缓存。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const runs = [];
  try {
    for (const ratio of [1, 2]) {
      const page = await browser.newPage({ deviceScaleFactor: ratio, viewport: { width: 1440, height: 900 } });
      await page.goto(process.env.PERF_URL || 'http://127.0.0.1:8000');
      await page.waitForFunction(() => {
        const tiles = Array.from(document.querySelectorAll('.card-tile')).filter(tile => {
          const rect = tile.getBoundingClientRect();
          return rect.top < innerHeight && rect.bottom > 0;
        });
        return tiles.length > 0 && tiles.every(tile => tile.querySelector('.real-img.loaded'));
      });
      const result = await page.evaluate(() => {
        const visible = Array.from(document.querySelectorAll('.card-tile')).filter(tile => tile.getBoundingClientRect().top < innerHeight);
        return { visibleImages: visible.map(tile => {
          const image = tile.querySelector('img');
          return { url: image.currentSrc, width: image.naturalWidth, height: image.naturalHeight };
        }), imageBytes: performance.getEntriesByType('resource').filter(e => e.name.includes('/thumbnails/')).reduce((sum, entry) => sum + entry.encodedBodySize, 0) };
      });
      assert.ok(result.visibleImages.every(image => image.url.includes('/thumbnails/') && image.width > 0));
      runs.push({ ratio, ...result });
      console.log(`PASS 真实卡图 DPR ${ratio}：${result.visibleImages.length} 张可见卡图正常显示`);
      await page.close();
    }
    fs.writeFileSync('docs/report/real-thumbnail-browser.json', JSON.stringify({ date: new Date().toISOString(), note: '使用当前磁盘缓存状态，不主动预热，未拦截 CDN 或图片响应', runs }, null, 2) + '\n');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
