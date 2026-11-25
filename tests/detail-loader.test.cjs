const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup(fetch) {
  const context = vm.createContext({
    window: { PTCG_LANG_DATA: { zh: { rows: [], columns: [], detailBase: '/details/' } } },
    fetch
  });
  vm.runInContext(fs.readFileSync('data-loader.js', 'utf8'), context);
  return context.window.PTCG_LOAD_DETAIL;
}

test('相同分片复用并发请求，重复卡牌 ID 仍按独立记录读取', async () => {
  let requests = 0;
  const load = setup(async () => {
    requests++;
    return { ok: true, json: async () => [{ id: 'same', n: '第一张' }, { id: 'same', n: '第二张' }] };
  });
  const [a, b] = await Promise.all([
    load({ id: 'same', _detail: 0, _detailKey: 0 }, 'zh'),
    load({ id: 'same', _detail: 0, _detailKey: 1 }, 'zh')
  ]);
  assert.equal(a.n, '第一张');
  assert.equal(b.n, '第二张');
  assert.equal(requests, 1);
});

test('分片下载失败可重试，缓存淘汰后重新请求', async () => {
  let requests = 0;
  const load = setup(async () => {
    requests++;
    return { ok: requests !== 1, status: 503, json: async () => [{ n: '皮卡丘' }] };
  });
  const card = { _detail: 0, _detailKey: 0 };
  await assert.rejects(load(card, 'zh'));
  assert.equal((await load(card, 'zh')).n, '皮卡丘');
  for (let i = 1; i <= 8; i++) await load({ _detail: i, _detailKey: 0 }, 'zh');
  await load(card, 'zh');
  assert.equal(requests, 11);
});
