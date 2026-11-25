// 使用真实慢 HTTP 图片响应，验证搜索索引不会排在整批图片之后。
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

(async () => {
  const server = spawn(process.env.PYTHON || 'python3', ['-u', path.join(__dirname, '../tests/fixtures/slow_image_server.py')], {
    stdio: ['ignore', 'pipe', 'inherit']
  });
  let browser;
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('慢图片服务启动超时')), 10000);
      const failed = error => finish(error);
      const exited = code => finish(new Error('慢图片服务提前退出：' + code));
      const ready = output => finish(null, Number(String(output).trim()));
      function finish(error, value) {
        clearTimeout(timer);
        server.removeListener('error', failed);
        server.removeListener('exit', exited);
        server.stdout.removeListener('data', ready);
        if (error) reject(error);
        else resolve(value);
      }
      server.once('error', failed);
      server.once('exit', exited);
      server.stdout.once('data', ready);
    });
    assert.ok(port > 0);
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.card-tile');
    await page.waitForFunction(() => !document.getElementById('searchInput').disabled, null, { timeout: 8000 });
    assert.equal(await page.evaluate(() => window.PTCG_LANG_DATA.zh.partial), undefined);
    console.log('PASS 图片每张延迟 2 秒时，完整搜索仍在 8 秒内就绪');
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
