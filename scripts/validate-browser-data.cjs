// 发布前逐张核对索引、搜索文本及详情定位，不依赖固定卡牌数量。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const context = vm.createContext({ window: {} });
function evaluate(file) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { timeout: 10000 });
  return context.window.PTCG_LANG_DATA.zh;
}
const original = evaluate(path.join(root, 'data/zh.js'));
const bootstrap = evaluate(path.join(root, 'data/zh-bootstrap.js'));
assert.match(bootstrap.indexUrl, /^data\/zh-index\/[a-f0-9]{12}\.js$/);
const compact = evaluate(path.join(root, bootstrap.indexUrl));
evaluate(path.join(__dirname, '../data-loader.js'));
assert.equal(compact.version, bootstrap.version);
assert.equal(compact.detailBase, bootstrap.detailBase);
assert.equal(compact.cards.length, original.cards.length);
assert.equal(bootstrap.totalCards, original.cards.length);
assert.equal(bootstrap.cards.length, Math.min(48, original.cards.length));
assert.deepEqual(bootstrap.cards, compact.releaseCards.slice(0, 48));
const chunks = new Map();
for (const [i, card] of compact.cards.entries()) {
  if (!chunks.has(card._detail)) {
    chunks.set(card._detail, JSON.parse(fs.readFileSync(path.join(root, compact.detailBase, card._detail + '.json'))));
  }
  const detail = chunks.get(card._detail)[card._detailKey];
  assert.deepEqual(detail, JSON.parse(JSON.stringify(original.cards[i])));
  assert.equal(card.n, detail.n);
  assert.equal(card.img, detail.img);
  assert.ok(card._search.includes(detail.n.toLowerCase()));
  for (const attack of detail.atk || []) {
    assert.ok(card._search.includes((attack.t || '').toLowerCase()));
  }
}
console.log('校验通过：' + compact.cards.length + ' 张卡牌，版本 ' + compact.version);
