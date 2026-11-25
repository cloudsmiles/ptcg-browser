const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('长列表仅保留视口及缓冲行，首尾和空结果范围合法', () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync('virtual-grid.js', 'utf8'), context);
  const range = context.window.PTCG_GRID_RANGE;
  const middle = range(2400, 6, 350, 12000, 900);
  assert.ok(middle.end - middle.start <= 66);
  assert.equal(middle.start % 6, 0);
  assert.ok(middle.top > 0);
  assert.ok(middle.bottom > 0);
  const first = range(48, 6, 350, -800, 900);
  assert.equal(first.start, 0);
  const last = range(49, 6, 350, 100000, 900);
  assert.equal(last.end, 49);
  assert.ok(last.start < last.end);
  const empty = range(0, 6, 350, 0, 900);
  assert.equal(empty.start, 0);
  assert.equal(empty.end, 0);
});
