// 指定目录构建，且旧首屏在新版本发布后仍可读取自己的完整索引。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

function load(file) {
  const context = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync(file, 'utf8'), context);
  return context.window.PTCG_LANG_DATA.zh;
}

test('隔离构建生成版本索引，后续发布保留旧页面的索引和详情', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ptcg-version-'));
  try {
    const source = path.join(root, 'source.js');
    function build(name) {
      const cards = Array.from({ length: 60 }, (_, i) => ({ id: 'same', n: name + i, lid: String(i), s: '1' }));
      fs.writeFileSync(source, 'window.PTCG_LANG_DATA = {zh:' + JSON.stringify({ cards, sets: [{ id: '1' }] }) + '};');
      execFileSync('node', ['scripts/build-browser-data.cjs', '--source', source, '--output-root', root]);
      return load(path.join(root, 'data/zh-bootstrap.js'));
    }
    const first = build('旧卡牌');
    assert.ok(first.indexUrl.startsWith('data/zh-index/'));
    assert.equal(first.version, load(path.join(root, first.indexUrl)).version);
    assert.equal(first.totalCards, 60);
    const second = build('新卡牌');
    assert.notEqual(first.indexUrl, second.indexUrl);
    assert.equal(load(path.join(root, first.indexUrl)).rows.length, 60);
    const oldDetails = JSON.parse(fs.readFileSync(path.join(root, first.detailBase, '0.json')));
    assert.equal(oldDetails[0].n, first.cards[0].n);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
