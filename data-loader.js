(function () {
  'use strict';

  window.PTCG_HYDRATE_INDEX = function () {
  var data = (window.PTCG_LANG_DATA || {}).zh;
  if (!data || !data.rows) return;
  var columns = data.columns;
  var encoded = new Set(data.encodedColumns || []);
  var dictionary = data.dictionary;
  function valueAt(row, i) {
    return row[i] !== null && encoded.has(i) ? dictionary[row[i]] : row[i];
  }
  data.cards = data.rows.map(function (row) {
    var card = {};
    columns.forEach(function (key, i) {
      if (row[i] !== null) card[key] = valueAt(row, i);
    });
    if (card.img) card.img = data.imagePrefix + card.img;
    if (card.altimg) card.altimg = data.altPrefix + card.altimg;
    card._order = row[columns.length + 3];
    card._detailKey = row[columns.length + 2];
    card._search = valueAt(row, columns.length);
    card._detail = row[columns.length + 1];
    return card;
  });
  data.releaseCards = data.cards.slice();
  // 原始序号连续，直接按位置还原，避免首次加载时再做一次全量排序。
  var originalCards = new Array(data.cards.length);
  data.cards.forEach(function (card) { originalCards[card._order] = card; });
  data.cards = originalCards;
  // 非默认排序从原始顺序开始，保留同名同数值卡牌的稳定顺序。
  // 释放中间数组，避免索引同时保留两份结构。
  delete data.rows;
  delete data.columns;
  delete data.dictionary;
  delete data.encodedColumns;

  };
  window.PTCG_HYDRATE_INDEX();

  var chunks = new Map();
  window.PTCG_LOAD_DETAIL = function (card, lang) {
    var current = window.PTCG_LANG_DATA[lang];
    if (card._detail === undefined || !current.detailBase) return Promise.resolve(card);
    var url = current.detailBase + card._detail + '.json';
    var pending = chunks.get(url);
    if (!pending) {
      pending = fetch(url).then(function (response) {
        if (!response.ok) throw new Error('详情加载失败：' + response.status);
        return response.json();
      }).catch(function (error) {
        chunks.delete(url);
        throw error;
      });
    }
    // 最多保留 8 个分片；失败的请求会移出缓存，允许重试。
    chunks.delete(url);
    chunks.set(url, pending);
    if (chunks.size > 8) chunks.delete(chunks.keys().next().value);
    return pending.then(function (details) {
      if (!details[card._detailKey]) throw new Error('未找到卡牌详情');
      return details[card._detailKey];
    });
  };
})();
