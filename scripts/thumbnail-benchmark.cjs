// 公网原图与本地缩略图的真实下载对比，先清空样本缓存才是严格冷缓存。
const fs = require('node:fs');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const base = process.env.PERF_URL || 'http://127.0.0.1:8000';
(async () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync('data/zh-index.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('data-loader.js', 'utf8'), context);
  const cards = context.window.PTCG_LANG_DATA.zh.releaseCards;
  const eligible = process.env.THUMB_KIND ? cards.filter(card => card.st === process.env.THUMB_KIND) : cards;
  const unique = new Map(eligible.slice(0, 48).map(card => [card.img, card]));
  const samples = Array.from(unique.values()).slice(0, Number(process.env.THUMB_SAMPLES || 8));
  async function download(url) {
    const start = performance.now();
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(url + ': ' + response.status);
    const bytes = (await response.arrayBuffer()).byteLength;
    return { bytes, ms: +(performance.now() - start).toFixed(1), type: response.headers.get('content-type') };
  }
  const results = [];
  for (const card of samples) {
    const match = card.img.match(/@([a-f0-9]{40})\/img\/(\d+)\/(\d+)\.png$/);
    const url = base + '/thumbnails/' + match[1] + '/480/' + match[2] + '/' + match[3] + '.webp';
    const original = await download(card.img);
    const firstThumbnail = await download(url);
    const cachedThumbnail = await download(url);
    results.push({ name: card.n, originalUrl: card.img, thumbnailUrl: url, original, firstThumbnail, cachedThumbnail });
    console.log(JSON.stringify(results[results.length - 1]));
  }
  const report = { date: new Date().toISOString(), note: '真实网络；首次缩略图含源图下载及转换，仅样本未被预热时为冷缓存；缓存请求为磁盘缓存，无浏览器缓存', results };
  fs.writeFileSync(process.argv[2] || 'docs/report/thumbnail-network.json', JSON.stringify(report, null, 2) + '\n');
})().catch(error => { console.error(error); process.exitCode = 1; });
