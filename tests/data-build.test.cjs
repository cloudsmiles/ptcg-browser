const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('轻量索引保留全部卡牌、招式搜索和默认顺序，详情可完整还原', () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync('data/zh.js', 'utf8'), context);
  const full = context.window.PTCG_LANG_DATA.zh;
  const sorted = full.cards.slice().sort((a, b) => (b.sd || '').localeCompare(a.sd || '') || (parseInt(a.lid, 10) || 0) - (parseInt(b.lid, 10) || 0));
  vm.runInContext(fs.readFileSync('data/zh-index.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('data-loader.js', 'utf8'), context);
  const compact = context.window.PTCG_LANG_DATA.zh;
  assert.equal(compact.cards.length, full.cards.length);
  const chunks = new Map();
  for (const [i, card] of compact.cards.entries()) {
    const source = full.cards[i];
    assert.ok(source);
    for (const key of ['id', 'n', 'st', 'hp', 'ty', 's', 'sn', 'se', 'sd', 'lid', 'r', 'rrank', 'tier', 'std', 'cat', 'sub', 'img', 'altimg', 'art']) {
      assert.equal(JSON.stringify(card[key]), JSON.stringify(source[key]), key + ': ' + i);
    }
    for (const attack of source.atk || []) {
      assert.ok(card._search.includes((attack.n || '').toLowerCase()));
      assert.ok(card._search.includes((attack.t || '').toLowerCase()));
    }
    if (!chunks.has(card._detail)) {
      chunks.set(card._detail, JSON.parse(fs.readFileSync(compact.detailBase + card._detail + '.json', 'utf8')));
    }
    assert.deepEqual(chunks.get(card._detail)[card._detailKey], JSON.parse(JSON.stringify(source)));
  }

  assert.deepEqual(Array.from(compact.releaseCards, c => c.img), Array.from(sorted, c => c.img));
  for (const compare of [
    (a, b) => a.n.localeCompare(b.n),
    (a, b) => (b.rrank || 0) - (a.rrank || 0) || a.n.localeCompare(b.n),
    (a, b) => (parseInt(b.hp, 10) || 0) - (parseInt(a.hp, 10) || 0),
    (a, b) => a.s !== b.s ? (b.sd || '').localeCompare(a.sd || '') : (parseInt(a.lid, 10) || 0) - (parseInt(b.lid, 10) || 0)
  ]) {
    assert.deepEqual(Array.from(compact.cards.slice().sort(compare), c => c.img), Array.from(full.cards.slice().sort(compare), c => c.img));
  }
  assert.ok(fs.statSync('data/zh-index.js').size < fs.statSync('data/zh.js').size * 0.55);
});


test('首屏数据仅包含 48 张，且与完整索引的默认首批及详情位置一致', () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync('data/zh-bootstrap.js', 'utf8'), context);
  const bootstrap = context.window.PTCG_LANG_DATA.zh;
  assert.equal(bootstrap.partial, true);
  assert.equal(bootstrap.cards.length, 48);
  assert.ok(fs.statSync('data/zh-bootstrap.js').size < 150000);
  vm.runInContext(fs.readFileSync('data/zh-index.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('data-loader.js', 'utf8'), context);
  const complete = context.window.PTCG_LANG_DATA.zh;
  assert.equal(bootstrap.totalCards, complete.cards.length);
  assert.equal(bootstrap.version, complete.version);
  assert.equal(bootstrap.indexUrl, complete.indexUrl);
  for (let i = 0; i < 48; i++) {
    assert.deepEqual(JSON.parse(JSON.stringify(bootstrap.cards[i])), JSON.parse(JSON.stringify(complete.releaseCards[i])));
  }
});
