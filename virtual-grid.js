(function () {
  'use strict';

  // 返回视口上下各 3 行缓冲；完整行占位确保滚动位置不随节点回收跳动。
  window.PTCG_GRID_RANGE = function (count, columns, rowHeight, offset, viewport) {
    var rows = Math.ceil(count / columns);
    var first = Math.max(0, Math.min(rows - 1, Math.floor(Math.max(0, offset) / rowHeight)));
    var startRow = Math.max(0, first - 3);
    var endRow = Math.min(rows, first + Math.ceil(viewport / rowHeight) + 4);
    return {
      start: startRow * columns,
      end: Math.min(count, endRow * columns),
      top: startRow * rowHeight,
      bottom: Math.max(0, (rows - endRow) * rowHeight)
    };
  };
})();
