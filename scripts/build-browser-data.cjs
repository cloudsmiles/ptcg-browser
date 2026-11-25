// 从原始数据生成轻量索引与带版本的详情分片，不修改原始数据。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { parseArgs } = require('node:util');
const { values: options } = parseArgs({ options: {
  source: { type: 'string' },
  'output-root': { type: 'string' }
} });
const projectRoot = path.resolve(__dirname, '..');
const root = path.resolve(options['output-root'] || projectRoot);
const raw = fs.readFileSync(options.source || path.join(projectRoot, 'data/zh.js'), 'utf8');
const context = vm.createContext({ window: {} });
vm.runInContext(raw, context);
const source = context.window.PTCG_LANG_DATA.zh;
const cards = source.cards.slice().sort((a, b) => (b.sd || '').localeCompare(a.sd || '') || (parseInt(a.lid, 10) || 0) - (parseInt(b.lid, 10) || 0));
const version = crypto.createHash('sha256').update(raw).update(fs.readFileSync(__filename)).digest('hex').slice(0, 12);
const detailBase = 'data/zh-details/' + version + '/';
const indexUrl = 'data/zh-index/' + version + '.js';
fs.mkdirSync(path.join(root, detailBase), { recursive: true });
const columns = ['id', 'n', 'st', 'hp', 'ty', 's', 'sn', 'se', 'sd', 'lid', 'r', 'rrank', 'tier', 'std', 'cat', 'sub', 'img', 'altimg', 'art'];
function commonPrefix(key) {
  let prefix = cards.find(c => c[key])?.[key] || '';
  for (const card of cards) {
    if (!card[key]) continue;
    while (!card[key].startsWith(prefix)) prefix = prefix.slice(0, -1);
  }
  return prefix;
}
const imagePrefix = commonPrefix('img');
const altPrefix = commonPrefix('altimg');
const rows = [];
const originalOrder = new Map(source.cards.map((card, index) => [card, index]));
const chunkSize = 128;
for (let start = 0; start < cards.length; start += chunkSize) {
  const details = [];
  const chunk = start / chunkSize;
  for (const card of cards.slice(start, start + chunkSize)) {
    details.push(card);
    const search = [card.n, card.art, card.r, card.sn, card.lid, card.sub];
    for (const attack of card.atk || []) search.push(attack.n, attack.t, attack.d);
    for (const ability of card.abi || []) search.push(ability.n, ability.t);
    const values = columns.map(key => key === 'img' && card.img ? card.img.slice(imagePrefix.length) : key === 'altimg' && card.altimg ? card.altimg.slice(altPrefix.length) : card[key] ?? null);
    values.push(search.join(' ').toLowerCase(), chunk, details.length - 1, originalOrder.get(card));
    rows.push(values);
  }
  fs.writeFileSync(path.join(root, detailBase, chunk + '.json'), JSON.stringify(details));
}
const { cards: ignored, ...metadata } = source;
// 首屏只携带默认排序前 48 张，保持详情定位与完整索引一致。
const bootstrapCards = rows.slice(0, 48).map(row => {
  const card = {};
  columns.forEach((key, i) => { if (row[i] !== null) card[key] = row[i]; });
  if (card.img) card.img = imagePrefix + card.img;
  if (card.altimg) card.altimg = altPrefix + card.altimg;
  card._search = row[columns.length];
  card._detail = row[columns.length + 1];
  card._detailKey = row[columns.length + 2];
  card._order = row[columns.length + 3];
  return card;
});
const bootstrap = { ...metadata, cards: bootstrapCards, releaseCards: bootstrapCards,
  detailBase, indexUrl, version, presorted: 'release', partial: true, totalCards: source.cards.length };
fs.writeFileSync(path.join(root, 'data/zh-bootstrap.js'),
  'window.PTCG_LANG_DATA = {zh:' + JSON.stringify(bootstrap) + '};\n');
// 对重复字符串用整数引用，减少首屏 JS 字面量的体积与解析工作。
const dictionary = [];
const strings = new Map();
const encodedColumns = [];
for (let i = 0; i <= columns.length; i++) {
  if (['hp', 'ty', 'rrank', 'tier'].includes(columns[i])) continue;
  encodedColumns.push(i);
  for (const row of rows) {
    if (row[i] === null) continue;
    if (!strings.has(row[i])) {
      strings.set(row[i], dictionary.length);
      dictionary.push(row[i]);
    }
    row[i] = strings.get(row[i]);
  }
}
const index = { ...metadata, columns, rows, dictionary, encodedColumns, imagePrefix, altPrefix,
  detailBase, indexUrl, version, totalCards: source.cards.length, presorted: 'release' };
const output = 'window.PTCG_LANG_DATA = window.PTCG_LANG_DATA || {};\nwindow.PTCG_LANG_DATA.zh = ' + JSON.stringify(index) + ';\n';
fs.writeFileSync(path.join(root, 'data/zh-index.js'), output);
fs.mkdirSync(path.join(root, 'data/zh-index'), { recursive: true });
fs.writeFileSync(path.join(root, indexUrl), output);
console.log(JSON.stringify({ version, cards: cards.length, sets: source.sets.length,
  originalBytes: Buffer.byteLength(raw), indexBytes: Buffer.byteLength(output),
  gzipBytes: zlib.gzipSync(output).length, detailChunks: Math.ceil(cards.length / chunkSize), detailBase, indexUrl }, null, 2));
