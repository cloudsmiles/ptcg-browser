// 不依赖浏览器的行为回归：验证节点保留、筛选结果与重复计算。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup() {
  const nodes = new Map();
  function element() {
    return {
      children: [],
      style: {},
      appendChild(child) {
        if (child.fragment) this.children.push(...child.children);
        else this.children.push(child);
      },
      replaceChildren(child) {
        this.children = [];
        if (child) this.appendChild(child);
      },
      get childElementCount() { return this.children.length; }
    };
  }
  const context = vm.createContext({
    window: {},
    localStorage: { getItem: () => null },
    document: {
      getElementById(id) {
        if (!nodes.has(id)) nodes.set(id, element());
        return nodes.get(id);
      },
      createDocumentFragment() { return { ...element(), fragment: true }; }
    }
  });
  let source = fs.readFileSync('app.js', 'utf8');
  source = source.slice(0, source.lastIndexOf('  if (!LANG_DATA.zh)')) + `
    cardTile = function (card, index) { return { card: card, index: index }; };
    window.api = {
      state: state, matches: matches, apply: apply, render: render,
      setCards: function (value) { cards = value; },
      setFiltered: function (value) { filtered = value; },
      countComparisons: function () {
        var original = compare;
        var count = 0;
        compare = function (a, b) { count++; return original(a, b); };
        return function () { return count; };
      }
    };
  })();`;
  vm.runInContext(source, context);
  return { api: context.window.api, nodes };
}

test('加载更多保留已有节点，并使用正确的详情索引', () => {
  const { api, nodes } = setup();
  api.setFiltered(Array.from({ length: 120 }, (_, id) => ({ id })));
  api.render();
  const first = nodes.get('cardGrid').children[0];
  api.state.visible = 96;
  api.render(true);
  assert.equal(nodes.get('cardGrid').children.length, 96);
  assert.equal(nodes.get('cardGrid').children[0], first);
  assert.equal(nodes.get('cardGrid').children[95].index, 95);
});

test('连续筛选复用排序，且仍正确筛选搜索结果', () => {
  const { api, nodes } = setup();
  api.setCards([{ n: '皮卡丘', lid: '2' }, { n: '喷火龙', lid: '1' }]);
  const count = api.countComparisons();
  api.apply();
  const initial = count();
  api.state.query = '皮卡丘';
  api.apply();
  assert.equal(nodes.get('cardGrid').children.length, 1);
  api.state.query = '';
  api.apply();
  assert.equal(count(), initial);
  assert.equal(nodes.get('cardGrid').children[0].card.n, '喷火龙');
});

test('不同查询复用卡牌搜索文本，大小写不影响结果', () => {
  const { api } = setup();
  let reads = 0;
  const card = { get n() { reads++; return 'Pikachu'; }, atk: [{ n: '电击', t: '造成伤害' }] };
  api.state.query = 'pikachu';
  assert.equal(api.matches(card), true);
  const initial = reads;
  api.state.query = '电击';
  assert.equal(api.matches(card), true);
  assert.equal(reads, initial);
  api.state.query = '不存在';
  assert.equal(api.matches(card), false);
});
