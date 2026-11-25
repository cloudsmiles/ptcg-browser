(function () {
  'use strict';

  var PAGE_SIZE = 48;
  var LANG_DATA = window.PTCG_LANG_DATA || {};

  var TYPE_COLORS = {
    Grass: '#63b34a', Fire: '#ef7a3a', Water: '#4b8fe8', Lightning: '#e8bd2b',
    Psychic: '#e35d94', Fighting: '#c45b3c', Darkness: '#5d6274', Dark: '#5d6274',
    Metal: '#8f9bb5', Fairy: '#e58cc0', Dragon: '#8b5cf6', Colorless: '#9aa3b5'
  };
  var TYPE_CN = {
    Grass: '草', Fire: '火', Water: '水', Lightning: '雷', Psychic: '超能',
    Fighting: '格斗', Darkness: '恶', Dark: '恶', Metal: '钢', Fairy: '妖精',
    Dragon: '龙', Colorless: '无色'
  };
  // 属性固定展示顺序（沿用官方属性顺序），未知属性排最后
  var TYPE_ORDER = [
    'Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting',
    'Darkness', 'Metal', 'Fairy', 'Dragon', 'Colorless'
  ];
  var NAME_CN = {
    'Charizard': '喷火龙', 'Pikachu': '皮卡丘', 'Mewtwo': '超梦', 'Mew': '梦幻',
    'Eevee': '伊布', 'Vaporeon': '水伊布', 'Jolteon': '雷伊布', 'Flareon': '火伊布',
    'Espeon': '太阳伊布', 'Umbreon': '月亮伊布', 'Leafeon': '叶伊布', 'Glaceon': '冰伊布',
    'Sylveon': '仙子伊布', 'Bulbasaur': '妙蛙种子', 'Ivysaur': '妙蛙草', 'Venusaur': '妙蛙花',
    'Squirtle': '杰尼龟', 'Wartortle': '卡咪龟', 'Blastoise': '水箭龟', 'Charmander': '小火龙',
    'Charmeleon': '火恐龙', 'Snorlax': '卡比兽', 'Gengar': '耿鬼', 'Gastly': '鬼斯',
    'Haunter': '鬼斯通', 'Dragonite': '快龙', 'Dratini': '迷你龙', 'Dragonair': '哈克龙',
    'Magikarp': '鲤鱼王', 'Gyarados': '暴鲤龙', 'Lucario': '路卡利欧', 'Riolu': '利欧路',
    'Greninja': '甲贺忍蛙', 'Incineroar': '炽焰咆哮虎', 'Rowlet': '木木枭', 'Solgaleo': '索尔迦雷欧',
    'Lunala': '露奈雅拉', 'Necrozma': '奈克洛兹玛', 'Mimikyu': '谜拟丘', 'Jigglypuff': '胖丁',
    'Wigglytuff': '胖可丁', 'Psyduck': '可达鸭', 'Slowpoke': '呆呆兽', 'Ditto': '百变怪',
    'Togepi': '波克比', 'Togetic': '波克基古', 'Togekiss': '波克基斯', 'Arceus': '阿尔宙斯',
    'Dialga': '帝牙卢卡', 'Palkia': '帕路奇亚', 'Giratina': '骑拉帝纳', 'Rayquaza': '烈空坐',
    'Kyogre': '盖欧卡', 'Groudon': '固拉多', 'Lugia': '洛奇亚', 'Ho-Oh': '凤王',
    'Moltres': '火焰鸟', 'Zapdos': '闪电鸟', 'Articuno': '急冻鸟', 'Lapras': '乘龙',
    'Snivy': '藤藤蛇', 'Serperior': '君主蛇', 'Samurott': '大剑鬼', 'Reshiram': '莱希拉姆',
    'Zekrom': '捷克罗姆', 'Koraidon': '故勒顿', 'Miraidon': '密勒顿', 'Sprigatito': '新叶喵',
    'Fuecoco': '呆火鳄', 'Quaxly': '润水鸭', 'Meowscarada': '魔幻假面喵', 'Skeledirge': '骨纹巨声鳄',
    'Quaquaval': '狂欢浪舞鸭', 'Magnezone': '自爆磁怪', 'Metagross': '巨金怪', 'Tyranitar': '班基拉斯',
    'Scizor': '巨钳螳螂', 'Haxorus': '双斧战龙', 'Baxcalibur': '戟脊龙'
  };
  var state = {
    lang: 'zh',
    query: '',
    types: new Set(),
    supertype: '',
    cat: '',
    setId: '',
    tier: '',
    rarity: new Set(),
    standard: false,
    sort: 'release',
    favOnly: false,
    visible: PAGE_SIZE
  };
  var cards = [];
  var sets = [];
  var filtered = [];
  var searchTextCache = new WeakMap();
  var sortedCardsCache = new Map();
  var currentIndex = -1;
  var modalRequest = 0;
  var gridMetrics = null;
  var renderedRangeKey = null;
  var gridFrame = null;
  var favorites = loadFavorites();
  var toastTimer = null;

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  function loadFavorites() {
    try { return new Set(JSON.parse(localStorage.getItem('ptcg-favs-v2') || '[]')); }
    catch (e) { return new Set(); }
  }
  function saveFavorites() {
    try { localStorage.setItem('ptcg-favs-v2', JSON.stringify(Array.from(favorites))); } catch (e) {}
  }
  function favKey(c) { return state.lang + ':' + c.id; }
  function toast(msg) {
    var el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 1800);
  }
  function cnName(name) {
    if (NAME_CN[name]) return NAME_CN[name];
    var base = name.replace(/\s+(VMAX|VSTAR|V|ex|EX|GX|BREAK|LV\.[X\d]+)$/i, '').trim();
    return NAME_CN[base] || '';
  }
  // 稀有度保留原始代号（SR / SAR / RR ...），等级由数据字段 rrank 提供
  function rarityLabel(r) { return r || '未标注'; }
  function isHighRarity(card) { return (card.rrank || 0) >= 6; }
  function typeColor(t) { return TYPE_COLORS[t] || '#9aa3b5'; }
  function typeLabel(t) { return TYPE_CN[t] || t; }
  function localImage(url) {
    var match = (url || '').match(/^https:\/\/(?:cdn\.jsdelivr\.net\/gh\/duanxr\/PTCG-CHS-Datasets@|raw\.githubusercontent\.com\/duanxr\/PTCG-CHS-Datasets\/)([a-f0-9]{40})\/img\/(\d+)\/(\d+)\.png$/);
    return match ? 'originals/' + match[1] + '/' + match[2] + '/' + match[3] + '.png' : url || '';
  }
  function imgOf(c, large) { return localImage(large ? (c.big || c.img || '') : (c.img || c.big || '')); }

  // 本地生成的简体中文卡面：外部卡图加载失败时自动露出，保证永远有内容、且为中文
  function typeIcon(t) {
    var map = { Grass:'叶', Fire:'火', Water:'水', Lightning:'雷', Psychic:'超', Fighting:'斗',
      Darkness:'恶', Dark:'恶', Metal:'钢', Fairy:'妖', Dragon:'龙', Colorless:'无' };
    return map[t] || '·';
  }
  function cardFace(card) {
    var isPoke = card.st === 'Pokemon' || card.hp;
    var types = (card.ty || []);
    var mainType = types[0] || 'Colorless';
    var color = typeColor(mainType);
    var head = '<div class="face-head" style="background:linear-gradient(135deg,' + color + ',' + shade(color, -28) + ')">' +
      '<span class="face-name">' + esc(card.n) + '</span>' +
      (card.hp ? '<span class="face-hp">HP ' + esc(card.hp) + '</span>' : '') + '</div>';
    var body = '';
    if (isPoke) {
      body += '<div class="face-illus"><span class="face-illus-ball">◉</span><span>' + esc(card.n) + '</span></div>';
      if ((card.abi || []).length) {
        body += card.abi.map(function (a) {
          return '<div class="face-ability"><b>【' + esc(a.n) + '】</b>' + (a.t ? '<span>' + esc(a.t) + '</span>' : '') + '</div>';
        }).join('');
      }
      if ((card.atk || []).length) {
        body += '<div class="face-attacks">' + card.atk.map(function (a) {
          var cost = (a.c || []).map(function (t) { return '<i style="background:' + typeColor(t) + '">' + typeIcon(t) + '</i>'; }).join('');
          return '<div class="face-atk"><div class="face-atk-h">' + cost + '<b>' + esc(a.n) + '</b><em>' + esc(a.d || '—') + '</em></div>' +
            (a.t ? '<p>' + esc(a.t) + '</p>' : '') + '</div>';
        }).join('') + '</div>';
      }
      if (card.ft) body += '<p class="face-flavor">' + esc(card.ft) + '</p>';
    } else {
      body += '<div class="face-trainer">' +
        '<div class="face-trainer-kind">' + esc(card.sub || card.st || '') + '</div>' +
        (card.ft ? '<p>' + esc(card.ft) + '</p>' : '') +
        ((card.atk || []).length ? '<div class="face-trainer-effect">' + card.atk.map(function (a) { return esc(a.t || a.n); }).join('') + '</div>' : '') +
        '</div>';
    }
    var foot = '<div class="face-foot"><span>' + esc(card.sn) + ' · #' + esc(card.lid) + '</span>' +
      '<span>' + esc(card.art || '') + '</span></div>';
    return '<div class="card-face" style="--face-color:' + color + '">' + head + body + foot + '</div>';
  }
  function shade(hex, amt) {
    var n = parseInt(hex.replace('#', ''), 16);
    var r = Math.max(0, Math.min(255, (n >> 16) + amt));
    var g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
    var b = Math.max(0, Math.min(255, (n & 255) + amt));
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }
  // 真实卡图加载成功则显示；主图床失败时切换备用图床；都失败则移除，露出下方本地卡面
  function bindCardImage(img) {
    if (!img) return;
    var ok = function () { img.classList.add('loaded'); };
    var failed = function () {
      var alt = img.getAttribute('data-alt');
      if (alt && img.src !== alt) {
        img.removeAttribute('data-alt');
        img.removeAttribute('srcset');
        img.removeAttribute('sizes');
        img.src = alt;
        img.addEventListener('load', ok);
        img.addEventListener('error', function () { img.remove(); });
        return;
      }
      img.remove();
    };
    if (img.complete) { (img.naturalWidth > 0 ? ok : failed)(); }
    else { img.addEventListener('load', ok); img.addEventListener('error', failed); }
  }
  function thumbnailOf(card, width) {
    var match = (card.img || '').match(/^https:\/\/cdn\.jsdelivr\.net\/gh\/duanxr\/PTCG-CHS-Datasets@([a-f0-9]{40})\/img\/(\d+)\/(\d+)\.png$/);
    if (!match) return '';
    return 'thumbnails/' + match[1] + '/' + width + '/' + match[2] + '/' + match[3] + '.webp';
  }

  function realImgTag(c, large) {
    var original = imgOf(c, large);
    if (!original) return '';
    var thumbnail = !large && thumbnailOf(c, 240);
    var src = thumbnail || original;
    var alt = thumbnail ? original : localImage(c.altimg);
    var responsive = thumbnail ? ' srcset="' + esc(src) + ' 240w, ' + esc(thumbnailOf(c, 480)) +
      ' 480w" sizes="(max-width: 640px) calc((100vw - 44px) / 2), 220px"' : '';
    return '<img class="real-img" src="' + esc(src) + '"' + responsive +
      (alt ? ' data-alt="' + esc(alt) + '"' : '') +
      ' decoding="async" alt="' + esc(c.n) + '"' + (large ? '' : ' loading="lazy"') + '>';
  }

  // 系列下拉框按类别分组；选择类别后只显示该类别下的系列
  function renderSetOptions() {
    var setSel = $('setFilter');
    setSel.replaceChildren();
    var all = document.createElement('option');
    all.value = '';
    all.textContent = state.cat ? '全部系列（' + state.cat + '）' : '全部系列';
    setSel.appendChild(all);
    var cats = state.cat ? [state.cat] : ((LANG_DATA[state.lang] || {}).categories || []);
    cats.forEach(function (cat) {
      var list = sets.filter(function (s) { return s.cat === cat; });
      if (!list.length) return;
      var og = document.createElement('optgroup');
      og.label = cat + ' (' + list.length + ')';
      list.forEach(function (s) {
        var o = document.createElement('option');
        o.value = s.id;
        o.textContent = s.name;
        og.appendChild(o);
      });
      setSel.appendChild(og);
    });
    setSel.value = state.setId;
  }

  // 稀有度表格：按 tier 分行，当前范围包含的代号高亮可选，未包含的灰色禁用
  function renderRarityOptions() {
    var wrap = $('rarityTable');
    wrap.replaceChildren();
    var scope = '';
    if (state.setId) {
      var chosen = sets.filter(function (s) { return s.id === state.setId; })[0];
      scope = chosen ? chosen.name : '';
    } else if (state.cat) {
      scope = '全部系列（' + state.cat + '）';
    }
    $('rarityScope').textContent = scope ? '当前范围：' + scope : '当前范围：全部卡牌';

    var pool = cards.filter(function (c) {
      return (!state.cat || c.cat === state.cat) && (!state.setId || c.s === state.setId);
    });
    // 当前范围内的稀有度计数
    var counts = {}, tierTotals = {};
    pool.forEach(function (c) {
      counts[c.r] = (counts[c.r] || 0) + 1;
      tierTotals[c.tier] = (tierTotals[c.tier] || 0) + 1;
    });
    // 全部卡中每个 tier 拥有的代号全集（含当前范围未收录的代号，用于显示灰色不可选）
    var universe = {};
    cards.forEach(function (c) {
      if (!universe[c.tier]) universe[c.tier] = {};
      universe[c.tier][c.r] = 1;
    });
    var tiers = (LANG_DATA[state.lang] || {}).tiers || [];
    tiers.forEach(function (t) {
      var tid = Number(t.id);
      var codes = Object.keys(universe[tid] || {});
      if (!codes.length) return;
      // 当前范围包含的排在前面，未包含的（灰色）排在后面
      codes.sort(function (a, b) {
        var ca = counts[a] ? 0 : 1, cb = counts[b] ? 0 : 1;
        return ca - cb || b.localeCompare(a);
      });
      var row = document.createElement('div');
      row.className = 'rarity-row';
      // 行首：整类选择
      var head = document.createElement('button');
      head.type = 'button';
      head.className = 'rarity-row-head' + (tierTotals[tid] ? '' : ' disabled');
      head.dataset.value = 'tier:' + t.id;
      head.disabled = !tierTotals[tid];
      head.innerHTML = '<span class="rt-name">' + esc(t.name) + '</span>' +
        '<span class="rt-count">' + (tierTotals[tid] || 0) + ' 张</span>';
      row.appendChild(head);
      // 该 tier 下的各代号
      codes.forEach(function (code) {
        var cell = document.createElement('button');
        cell.type = 'button';
        var has = !!counts[code];
        cell.className = 'rarity-cell' + (has ? '' : ' disabled');
        cell.dataset.value = code;
        cell.disabled = !has;
        cell.title = has ? (counts[code] + ' 张') : '当前范围无此稀有度';
        cell.textContent = rarityLabel(code) + (has ? ' (' + counts[code] + ')' : '');
        row.appendChild(cell);
      });
      wrap.appendChild(row);
    });
    syncRarityActive();
  }

  // 单个稀有度值的显示名（用于多选摘要）
  function rarityValueName(r) {
    if (r.indexOf('tier:') === 0) {
      var t = ((LANG_DATA[state.lang] || {}).tiers || []).filter(function (x) {
        return String(x.id) === r.slice(5);
      })[0];
      return t ? t.name.split(' · ')[0] : '已选等级';
    }
    return rarityLabel(r);
  }

  // 同步稀有度表格的选中态与「清除选择」按钮
  function syncRarityActive() {
    document.querySelectorAll('#rarityTable button').forEach(function (b) {
      if (!b.disabled) b.classList.toggle('active', state.rarity.has(b.dataset.value));
    });
    var clear = $('rarityClear');
    if (clear) clear.disabled = state.rarity.size === 0;
    var sum = $('raritySummary');
    if (sum) {
      if (!state.rarity.size) {
        sum.textContent = '全部稀有度';
      } else {
        var names = Array.from(state.rarity).map(rarityValueName);
        sum.textContent = names.length <= 2 ? names.join(' · ') : ('已选 ' + names.length + ' 项');
      }
    }
  }

  // 折叠栏上显示当前选中的属性摘要
  function updateTypeSummary() {
    var el = $('typeSummary');
    if (!el) return;
    if (!state.types.size) { el.textContent = '全部属性'; return; }
    var names = TYPE_ORDER.filter(function (t) { return state.types.has(t); })
      .concat(Array.from(state.types).filter(function (t) { return TYPE_ORDER.indexOf(t) < 0; }))
      .map(function (t) { return typeLabel(t); });
    el.textContent = names.join(' · ');
  }

  // 「卡牌与系列」折叠栏摘要
  function updateClassSummary() {
    var el = $('classSummary');
    if (!el) return;
    var parts = [];
    if (state.supertype) {
      parts.push({ Pokemon: '宝可梦', Trainer: '训练家', Energy: '能量' }[state.supertype] || state.supertype);
    }
    if (state.setId) {
      var s = sets.filter(function (x) { return x.id === state.setId; })[0];
      parts.push(s ? s.name : '指定系列');
    } else if (state.cat) {
      parts.push('全部' + state.cat);
    }
    el.textContent = parts.length ? parts.join(' · ') : '全部卡牌';
  }

  function initFilters() {
    var label = (LANG_DATA[state.lang] || {}).label || '';
    $('updatePill').textContent = label + ' · ' + ((LANG_DATA[state.lang] || {}).totalCards || cards.length) + ' 张卡牌';

    var typeCount = {};
    cards.forEach(function (c) { (c.ty || []).forEach(function (t) { typeCount[t] = (typeCount[t] || 0) + 1; }); });
    // 按固定属性顺序排列（数量仅作为次要信息展示），未知属性排在最后
    var types = Object.keys(typeCount).sort(function (a, b) {
      var ia = TYPE_ORDER.indexOf(a), ib = TYPE_ORDER.indexOf(b);
      if (ia < 0) ia = 99; if (ib < 0) ib = 99;
      return ia - ib || a.localeCompare(b);
    });
    var row = $('typeRow');
    row.replaceChildren();
    var all = document.createElement('button');
    all.type = 'button';
    all.className = 'type-chip type-all active';
    all.innerHTML = '<span class="tc-cn">全部</span><span class="tc-en">ALL</span>';
    all.addEventListener('click', function () {
      state.types.clear();
      row.querySelectorAll('.type-chip').forEach(function (n) { n.classList.remove('active'); });
      all.classList.add('active');
      updateTypeSummary();
      apply();
    });
    row.appendChild(all);
    types.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'type-chip';
      b.style.setProperty('--chip-color', typeColor(t));
      b.innerHTML = '<span class="tc-dot" style="background:' + typeColor(t) + '"></span>' +
        '<span class="tc-cn">' + esc(typeLabel(t)) + '</span>' +
        '<span class="tc-en">' + esc(t) + '</span>' +
        '<span class="tc-num">' + typeCount[t] + '</span>';
      b.addEventListener('click', function () {
        if (state.types.has(t)) state.types.delete(t); else state.types.add(t);
        b.classList.toggle('active', state.types.has(t));
        all.classList.toggle('active', state.types.size === 0);
        updateTypeSummary();
        apply();
      });
      row.appendChild(b);
    });

    var catSel = $('catFilter');
    catSel.innerHTML = '<option value="">全部类别</option>';
    ((LANG_DATA[state.lang] || {}).categories || []).forEach(function (cat) {
      var n = sets.filter(function (s) { return s.cat === cat; }).length;
      if (!n) return;
      var o = document.createElement('option');
      o.value = cat;
      o.textContent = cat + ' (' + n + ')';
      catSel.appendChild(o);
    });
    catSel.value = state.cat;
    renderSetOptions();
    updateClassSummary();

    renderRarityOptions();
  }

  function matches(card) {
    if (state.favOnly && !favorites.has(favKey(card))) return false;
    if (state.supertype && card.st !== state.supertype) return false;
    if (state.cat && card.cat !== state.cat) return false;
    if (state.setId && card.s !== state.setId) return false;
    if (state.rarity.size) {
      // 多选：任一命中即通过（整类 tier:N 或具体代号）
      var hit = false;
      state.rarity.forEach(function (r) {
        if (hit) return;
        if (r.indexOf('tier:') === 0) {
          if (card.tier === Number(r.slice(5))) hit = true;
        } else if (card.r === r) hit = true;
      });
      if (!hit) return false;
    }
    if (state.standard && card.std !== 'Legal') return false;
    if (state.types.size && !(card.ty || []).some(function (t) { return state.types.has(t); })) return false;
    if (state.query) {
      var q = state.query.toLowerCase();
      if (card._search !== undefined) return card._search.includes(q);
      var cached = searchTextCache.get(card);
      if (!cached || cached.lang !== state.lang) {
        var hay = [card.n, card.art, card.r, card.sn, card.lid, card.sub];
        if (state.lang === 'en') hay.push(cnName(card.n));
        (card.atk || []).forEach(function (a) { hay.push(a.n, a.t, a.d); });
        (card.abi || []).forEach(function (a) { hay.push(a.n, a.t); });
        cached = { lang: state.lang, text: hay.join(' ').toLowerCase() };
        searchTextCache.set(card, cached);
      }
      if (!cached.text.includes(q)) return false;
    }
    return true;
  }

  function compare(a, b) {
    switch (state.sort) {
      case 'name': return a.n.localeCompare(b.n);
      case 'number':
        if (a.s !== b.s) return (b.sd || '').localeCompare(a.sd || '');
        return (parseInt(a.lid, 10) || 0) - (parseInt(b.lid, 10) || 0);
      case 'rarity': return (b.rrank || 0) - (a.rrank || 0) || a.n.localeCompare(b.n);
      case 'hp': return (parseInt(b.hp, 10) || 0) - (parseInt(a.hp, 10) || 0);
      default: return (b.sd || '').localeCompare(a.sd || '') || (parseInt(a.lid, 10) || 0) - (parseInt(b.lid, 10) || 0);
    }
  }

  function apply() {
    // 同一语言和排序方式只排序一次；过滤保持原排序的稳定性。
    var sorted = sortedCardsCache.get(state.sort);
    if (!sorted) {
      sorted = (LANG_DATA[state.lang] || {}).presorted === state.sort ? LANG_DATA[state.lang].releaseCards : cards.slice().sort(compare);
      sortedCardsCache.set(state.sort, sorted);
    }
    filtered = sorted.filter(matches);
    state.visible = PAGE_SIZE;
    currentIndex = -1;
    modalRequest++;
    if (window.PTCG_GRID_RANGE && $('cardGrid').getBoundingClientRect().top < 0) {
      $('cardGrid').scrollIntoView({ block: 'start' });
    }
    render();
  }

  function cardTile(card, i) {
    var cn = state.lang === 'en' ? cnName(card.n) : '';
    var fav = favorites.has(favKey(card));
    var el = document.createElement('article');
    el.className = window.PTCG_GRID_RANGE ? 'card-tile virtual-tile' : 'card-tile';
    el.dataset.index = i;
    el.style.animationDelay = Math.min(i, 20) * 8 + 'ms';
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', '查看 ' + card.n + ' 详情');
    el.innerHTML =
      '<div class="card-art">' +
        realImgTag(card, false) +
        '<button type="button" class="fav-btn' + (fav ? ' on' : '') + '" data-fav="' + esc(favKey(card)) + '" aria-label="收藏">' + (fav ? '♥' : '♡') + '</button>' +
        '<span class="set-badge">' + esc(card.sn) + ' · ' + esc(card.lid) + '</span>' +
      '</div>' +
      '<div class="card-meta">' +
        '<p class="card-name">' + esc(card.n) + (cn ? '<span class="card-name-cn">' + esc(cn) + '</span>' : '') + '</p>' +
        '<div class="card-sub"><span>' + esc(card.sub || card.st) + '</span>' +
        '<span class="rarity-tag' + (isHighRarity(card) ? ' high' : '') + '">' + esc(rarityLabel(card.r)) + '</span></div>' +
      '</div>';
    bindCardImage(el.querySelector('.real-img'));
    return el;
  }

  function measureGrid() {
    var grid = $('cardGrid');
    var style = getComputedStyle(grid);
    var columns = style.gridTemplateColumns.split(' ').length;
    var gap = parseFloat(style.rowGap) || 0;
    var width = (grid.clientWidth - (columns - 1) * gap) / columns;
    var padding = window.innerWidth <= 640 ? 7 : 10;
    // 卡牌元数据固定高度，行高可由宽度精确计算，无需遍历所有卡片测量。
    return { columns: columns, rowHeight: (width - 2 * padding - 2) * 1.38 + 2 * padding + 2 + 68 + gap };
  }

  function renderWindow() {
    var grid = $('cardGrid');
    var count = Math.min(state.visible, filtered.length);
    if (!gridMetrics) gridMetrics = measureGrid();
    var rect = grid.getBoundingClientRect();
    var range = window.PTCG_GRID_RANGE(count, gridMetrics.columns, gridMetrics.rowHeight,
      -rect.top, window.innerHeight);
    var rangeKey = [range.start, range.end, range.top, range.bottom].join(':');
    // 未跨越虚拟窗口边界时，无需扫描、增删节点或重复写样式。
    if (rangeKey === renderedRangeKey) return;
    renderedRangeKey = rangeKey;
    var wanted = new Set();
    for (var i = range.start; i < range.end; i++) wanted.add(String(i));
    // 焦点所在卡片被回收前，将焦点交回列表，避免落到已移除的节点。
    var active = document.activeElement && document.activeElement.closest('.card-tile');
    if (active && grid.contains(active)) {
      var focusIndex = Number(active.dataset.index);
      if (!wanted.has(String(focusIndex))) {
        active.blur();
        grid.focus({ preventScroll: true });
      }
    }
    var existing = new Map();
    grid.querySelectorAll('.card-tile').forEach(function (tile) {
      if (wanted.has(tile.dataset.index)) existing.set(tile.dataset.index, tile);
      else tile.remove();
    });
    // 保留窗口重叠区域的节点原位；移入 Fragment 会重新触发动画和图片状态。
    var cursor = grid.firstElementChild;
    for (var j = range.start; j < range.end; j++) {
      var tile = existing.get(String(j));
      if (tile) {
        cursor = tile.nextElementSibling;
      } else {
        grid.insertBefore(cardTile(filtered[j], j), cursor);
      }
    }
    // 使用 padding 而非占位元素，避免额外 grid gap 改变总高度。
    grid.style.paddingTop = range.top + 'px';
    grid.style.paddingBottom = range.bottom + 'px';
  }

  function scheduleGrid() {
    if (gridFrame !== null) return;
    gridFrame = requestAnimationFrame(function () {
      gridFrame = null;
      renderWindow();
    });
  }

  function render(append) {
    var grid = $('cardGrid');
    if (!append) {
      renderedRangeKey = null;
      grid.replaceChildren();
      grid.style.paddingTop = '0px';
      grid.style.paddingBottom = '0px';
    }
    if (window.PTCG_GRID_RANGE) {
      renderWindow();
    } else {
      // 保持未加载虚拟列表模块的旧页面兼容。
      var start = append ? grid.childElementCount : 0;
      var frag = document.createDocumentFragment();
      for (var i = start; i < Math.min(state.visible, filtered.length); i++) {
        frag.appendChild(cardTile(filtered[i], i));
      }
      if (append) grid.appendChild(frag);
      else grid.replaceChildren(frag);
    }
    var end = Math.min(state.visible, filtered.length);
    $('resultText').innerHTML = filtered.length
      ? '找到 <span>' + filtered.length.toLocaleString() + '</span> 张卡牌 · 当前显示 ' + end + ' 张'
      : '没有符合条件的卡牌';
    $('emptyState').hidden = filtered.length !== 0;
    $('loadMoreWrap').hidden = state.visible >= filtered.length;
  }

  function toggleFav(card) {
    var key = favKey(card);
    if (favorites.has(key)) { favorites.delete(key); toast('已取消收藏'); }
    else { favorites.add(key); toast('已加入收藏'); }
    saveFavorites();
    if (state.favOnly) apply();
    else {
      document.querySelectorAll('.fav-btn').forEach(function (b) {
        if (b.dataset.fav === key) {
          var on = favorites.has(key);
          b.classList.toggle('on', on);
          b.textContent = on ? '♥' : '♡';
        }
      });
    }
  }

  function energyHtml(cost) {
    return (cost || []).map(function (t) {
      var initial = ({ Grass: '草', Fire: '火', Water: '水', Lightning: '雷', Psychic: '超',
        Fighting: '斗', Darkness: '恶', Dark: '恶', Metal: '钢', Fairy: '妖', Dragon: '龙', Colorless: '无' })[t] || (t || '?').charAt(0);
      return '<span class="energy" title="' + esc(t) + '" style="background:' + typeColor(t) + '">' + esc(initial) + '</span>';
    }).join('');
  }

  async function openModal(index) {
    var c = filtered[index];
    if (!c) return;
    currentIndex = index;
    var request = ++modalRequest;
    if (window.PTCG_LOAD_DETAIL && c._detail !== undefined) {
      $('modal').hidden = false;
      document.body.style.overflow = 'hidden';
      $('modalBody').innerHTML = '<p class="detail-loading" role="status">正在加载卡牌详情…</p>';
      try {
        c = await window.PTCG_LOAD_DETAIL(c, state.lang);
      } catch (error) {
        if (request !== modalRequest) return;
        $('modalBody').innerHTML = '<div class="detail-loading"><p role="alert">卡牌详情加载失败，请重试。</p><button type="button" id="retryDetail">重新加载</button></div>';
        $('retryDetail').addEventListener('click', function () { openModal(index); });
        return;
      }
      if (request !== modalRequest) return;
    }
    var fav = favorites.has(favKey(c));
    var logo = c.sl || c.ssym;
    var large = imgOf(c, true);
    var small = imgOf(c, false);
    var mainTag = realImgTag(c, true);
    if (mainTag) mainTag = mainTag.replace('<img ', '<img id="mainImage" ');
    var html = '<div class="modal-image-col">' +
      '<div class="modal-face-wrap">' + cardFace(c) + mainTag +
      '</div>' +
      '<div class="modal-thumbs">' +
        '<button type="button" class="' + (large ? '' : 'active') + '" data-face="1">文字卡面</button>' +
        (large ? '<img class="active real-img" src="' + esc(large) + '"' + (c.altimg ? ' data-alt="' + esc(localImage(c.altimg)) + '"' : '') + ' data-src="' + esc(large) + '" alt="卡牌大图">' : '') +
        (small && small !== large ? '<img class="real-img" src="' + esc(small) + '"' + (c.altimg ? ' data-alt="' + esc(localImage(c.altimg)) + '"' : '') + ' data-src="' + esc(small) + '" alt="卡牌图">' : '') +
      '</div></div><div class="modal-info-col">' +
      '<div class="modal-set-line">' + (logo ? '<img src="' + esc(logo) + '" alt="">' : '') +
        '<span>' + esc(c.se) + ' · ' + esc(c.sn) + ' · ' + esc((c.sd || '').replace(/\//g, '-')) + ' · #' + esc(c.lid) + '</span></div>' +
      '<h2 id="modalTitle">' + esc(c.n) + '</h2>' +
      (state.lang === 'en' && cnName(c.n) ? '<p class="modal-cn">' + esc(cnName(c.n)) + '</p>' : '') +
      '<div class="modal-tags">' +
        (c.ty || []).map(function (t) { return '<span class="tag type" style="background:' + typeColor(t) + '">' + esc(typeLabel(t)) + ' · ' + esc(t) + '</span>'; }).join('') +
        '<span class="tag">' + esc(c.st) + '</span>' +
        (c.sub ? '<span class="tag">' + esc(c.sub) + '</span>' : '') +
        '<span class="tag rarity">' + esc(rarityLabel(c.r)) + '</span>' +
        (c.std === 'Legal' ? '<span class="tag legal">标准赛制可用</span>' : '') +
      '</div>' +
      '<div class="stat-grid">' +
        '<div class="stat-box"><span class="k">HP 生命值</span><span class="v">' + esc(c.hp || '—') + '</span></div>' +
        '<div class="stat-box"><span class="k">稀有度</span><span class="v">' + esc(rarityLabel(c.r)) + '</span></div>' +
        '<div class="stat-box"><span class="k">弱点</span><span class="v">' + esc((c.weak || []).map(function (w) { return (w.t || '') + ' ' + (w.v || ''); }).join('、') || '无') + '</span></div>' +
        '<div class="stat-box"><span class="k">撤退费用</span><span class="v">' + esc(c.rc || 0) + ' 能量</span></div>' +
      '</div>';

    if ((c.abi || []).length) {
      html += '<div class="section-title">特性</div>' + c.abi.map(function (a) {
        return '<div class="ability-box"><div class="ability-name">' + esc(a.n) + (a.y ? ' <span class="tag">' + esc(a.y) + '</span>' : '') + '</div>' +
          (a.t ? '<p class="attack-text">' + esc(a.t) + '</p>' : '') + '</div>';
      }).join('');
    }
    if ((c.atk || []).length) {
      html += '<div class="section-title">招式</div>' + c.atk.map(function (a) {
        return '<div class="attack-box"><div class="attack-head"><span class="attack-name">' + esc(a.n) + '</span>' +
          '<span class="energy-cost">' + energyHtml(a.c) + '</span><span class="damage">' + esc(a.d || '—') + '</span></div>' +
          (a.t ? '<p class="attack-text">' + esc(a.t) + '</p>' : '') + '</div>';
      }).join('');
    }
    if (c.ft) html += '<div class="section-title">卡牌描述</div><p class="flavor">' + esc(c.ft) + '</p>';
    html += '<div class="section-title">卡牌信息</div>' +
      '<div class="stat-grid">' +
        '<div class="stat-box"><span class="k">插画师</span><span class="v" style="font-size:12px">' + esc(c.art || '—') + '</span></div>' +
        '<div class="stat-box"><span class="k">图鉴编号</span><span class="v">' + esc((c.dex || []).slice(0, 5).join(', ') || '—') + '</span></div>' +
        '<div class="stat-box"><span class="k">系列</span><span class="v" style="font-size:12px">' + esc(c.se) + '</span></div>' +
        '<div class="stat-box"><span class="k">赛制</span><span class="v" style="font-size:12px">' + esc(c.std || '—') + '</span></div>' +
      '</div>' +
      '<div class="modal-links">' +
        '<button type="button" id="modalFav" class="' + (fav ? 'on' : '') + '">' + (fav ? '♥ 已收藏' : '♡ 收藏此卡') + '</button>' +
        '<a href="https://www.pokemon.cn/" target="_blank" rel="noopener">官方卡牌数据库 ↗</a>' +
        (index > 0 ? '<button type="button" data-nav="-1">← 上一张</button>' : '') +
        (index < filtered.length - 1 ? '<button type="button" data-nav="1">下一张 →</button>' : '') +
      '</div></div>';

    var body = $('modalBody');
    body.innerHTML = html;
    $('modal').hidden = false;
    document.body.style.overflow = 'hidden';

    var mainImg = $('mainImage');
    bindCardImage(mainImg);
    // 真实图缩略图：切换主图；加载失败的缩略图直接移除
    body.querySelectorAll('.modal-thumbs img').forEach(function (thumb) {
      bindCardImage(thumb);
      thumb.addEventListener('click', function () {
        if (!mainImg || !thumb.dataset.src) return;
        mainImg.style.display = '';
        if (mainImg.src !== thumb.dataset.src) {
          var alt = thumb.getAttribute('data-alt');
          if (alt) mainImg.setAttribute('data-alt', alt);
          mainImg.src = thumb.dataset.src;
          mainImg.classList.remove('loaded');
          bindCardImage(mainImg);
        }
        body.querySelectorAll('.modal-thumbs > *').forEach(function (n) { n.classList.remove('active'); });
        thumb.classList.add('active');
      });
    });
    // 中文卡面缩略图：隐藏真实图，露出底层卡面
    var faceBtn = body.querySelector('.modal-thumbs [data-face]');
    if (faceBtn) faceBtn.addEventListener('click', function () {
      if (mainImg) mainImg.style.display = 'none';
      body.querySelectorAll('.modal-thumbs > *').forEach(function (n) { n.classList.remove('active'); });
      faceBtn.classList.add('active');
    });
    $('modalFav').addEventListener('click', function () {
      toggleFav(c);
      var on = favorites.has(favKey(c));
      $('modalFav').textContent = on ? '♥ 已收藏' : '♡ 收藏此卡';
      $('modalFav').classList.toggle('on', on);
    });
    body.querySelectorAll('[data-nav]').forEach(function (b) {
      b.addEventListener('click', function () { openModal(index + Number(b.dataset.nav)); });
    });
  }

  function closeModal() {
    modalRequest++;
    $('modal').hidden = true;
    document.body.style.overflow = '';
    currentIndex = -1;
  }

  function resetState() {
    state.query = ''; state.types.clear(); state.supertype = ''; state.cat = ''; state.setId = '';
    state.tier = ''; state.rarity.clear(); state.standard = false; state.sort = 'release'; state.favOnly = false;
    state.visible = PAGE_SIZE;
    $('searchInput').value = ''; $('clearSearch').classList.remove('visible');
    $('supertypeFilter').value = ''; $('catFilter').value = '';
    renderSetOptions();
    syncRarityActive();
    updateTypeSummary();
    updateClassSummary();
    $('sortSelect').value = 'release'; $('standardOnly').checked = false;
    $('favToggle').setAttribute('aria-pressed', 'false');
  }

  function activateLang(lang) {
    if (!LANG_DATA[lang]) return;
    state.lang = lang;
    var d = LANG_DATA[lang];
    cards = d.cards || [];
    sortedCardsCache.clear();
    searchTextCache = new WeakMap();
    sets = d.sets || [];
    resetState();
    initFilters();
    apply();
  }

  function bindEvents() {
    var timer;
    var grid = $('cardGrid');
    grid.tabIndex = -1;
    // 委托到容器，事件监听器数量不随卡片数量增加。
    grid.addEventListener('click', function (event) {
      var tile = event.target.closest('.card-tile');
      if (!tile) return;
      var index = Number(tile.dataset.index);
      if (event.target.closest('.fav-btn')) toggleFav(filtered[index]);
      else openModal(index);
    });
    grid.addEventListener('keydown', function (event) {
      if (event.target.closest('.fav-btn')) return;
      var tile = event.target.closest('.card-tile');
      if (tile && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        openModal(Number(tile.dataset.index));
      }
    });
    if (window.PTCG_GRID_RANGE) {
      window.addEventListener('scroll', scheduleGrid, { passive: true });
      new ResizeObserver(function () {
        gridMetrics = null;
        scheduleGrid();
      }).observe(grid);
    }
    // 属性 / 稀有度折叠开关
    function bindFold(toggleId, bodyId) {
      $(toggleId).addEventListener('click', function () {
        var btn = $(toggleId);
        var open = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!open));
        $(bodyId).hidden = open;
      });
    }
    bindFold('typeFoldToggle', 'typeFoldBody');
    bindFold('classFoldToggle', 'classFoldBody');
    bindFold('rarityFoldToggle', 'rarityFoldBody');
    $('searchInput').addEventListener('input', function (e) {
      state.query = e.target.value.trim();
      $('clearSearch').classList.toggle('visible', !!e.target.value);
      clearTimeout(timer);
      timer = setTimeout(apply, 160);
    });
    $('clearSearch').addEventListener('click', function () {
      $('searchInput').value = ''; $('clearSearch').classList.remove('visible');
      state.query = ''; apply();
    });
    document.querySelectorAll('.quick-term').forEach(function (b) {
      b.addEventListener('click', function () {
        $('searchInput').value = b.dataset.term;
        $('clearSearch').classList.add('visible');
        state.query = b.dataset.term; apply();
      });
    });
    $('supertypeFilter').addEventListener('change', function (e) {
      state.supertype = e.target.value; updateClassSummary(); apply();
    });
    $('catFilter').addEventListener('change', function (e) {
      state.cat = e.target.value;
      state.setId = '';
      state.rarity.clear();
      renderSetOptions();
      renderRarityOptions();
      updateClassSummary();
      apply();
    });
    $('setFilter').addEventListener('change', function (e) {
      state.setId = e.target.value;
      state.rarity.clear();
      renderRarityOptions();
      updateClassSummary();
      apply();
    });
    // 稀有度表格：多选，点击切换，再点一次取消
    $('rarityTable').addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn || btn.disabled) return;
      var val = btn.dataset.value;
      if (state.rarity.has(val)) state.rarity.delete(val); else state.rarity.add(val);
      syncRarityActive();
      apply();
    });
    $('rarityClear').addEventListener('click', function () {
      state.rarity.clear();
      syncRarityActive();
      apply();
    });
    $('sortSelect').addEventListener('change', function (e) { state.sort = e.target.value; apply(); });
    $('standardOnly').addEventListener('change', function (e) { state.standard = e.target.checked; apply(); });
    $('favToggle').addEventListener('click', function () {
      state.favOnly = !state.favOnly;
      $('favToggle').setAttribute('aria-pressed', String(state.favOnly));
      apply();
      toast(state.favOnly ? '仅显示已收藏卡牌' : '显示全部卡牌');
    });
    $('resetBtn').addEventListener('click', function () { resetState(); initFilters(); apply(); });
    $('emptyReset').addEventListener('click', function () { resetState(); initFilters(); apply(); });
    $('loadMore').addEventListener('click', function () { state.visible += PAGE_SIZE; render(true); });
    $('modalClose').addEventListener('click', closeModal);
    $('modal').addEventListener('click', function (e) { if (e.target === $('modal')) closeModal(); });
    $('toTop').addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
    window.addEventListener('scroll', function () { $('toTop').classList.toggle('visible', window.scrollY > 500); }, { passive: true });
    document.addEventListener('keydown', function (e) {
      if (e.key === '/' && document.activeElement !== $('searchInput') && $('modal').hidden) {
        e.preventDefault(); $('searchInput').focus();
      }
      if (e.key === 'Escape' && !$('modal').hidden) closeModal();
      if (!$('modal').hidden && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        var d = e.key === 'ArrowRight' ? 1 : -1;
        if (currentIndex + d >= 0 && currentIndex + d < filtered.length) openModal(currentIndex + d);
      }
    });
  }

  var indexPromise = null;
  function setIndexControls(disabled) {
    document.querySelectorAll('#searchInput, #clearSearch, .quick-term, .filters button, .filters select, #sortSelect, #standardOnly, #favToggle, #resetBtn, #loadMore').forEach(function (control) {
      control.disabled = disabled;
    });
  }

  function loadFullIndex() {
    if (indexPromise) return indexPromise;
    var expectedVersion = LANG_DATA.zh.version;
    var expectedTotal = LANG_DATA.zh.totalCards;
    indexPromise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = LANG_DATA.zh.indexUrl || 'data/zh-index.js';
      script.async = true;
      // 首屏绘制后优先补齐索引，避免 HTTP 连接被慢图片长期占满。
      script.fetchPriority = 'high';
      script.onload = function () {
        script.remove();
        try {
          window.PTCG_HYDRATE_INDEX();
          if (!LANG_DATA.zh.cards || LANG_DATA.zh.cards.length !== expectedTotal ||
              (expectedVersion && LANG_DATA.zh.version !== expectedVersion)) {
            throw new Error('索引版本或卡牌数量不一致，请刷新页面');
          }
          resolve();
        } catch (error) { reject(error); }
      };
      script.onerror = function () { script.remove(); reject(new Error('索引加载失败')); };
      document.head.appendChild(script);
    }).then(function () {
      cards = LANG_DATA.zh.cards;
      sets = LANG_DATA.zh.sets || [];
      sortedCardsCache.clear();
      searchTextCache = new WeakMap();
      sortedCardsCache.set('release', LANG_DATA.zh.releaseCards);
      filtered = LANG_DATA.zh.releaseCards;
      setIndexControls(false);
      initFilters();
      // 原位补全数据，不重新插入首屏卡片，也不改变用户滚动或详情状态。
      render(true);
      $('indexStatus').remove();
    }).catch(function () {
      indexPromise = null;
      $('indexStatus').innerHTML = '完整搜索暂不可用，首批卡牌仍可浏览。 <button type="button" id="retryIndex">重新加载</button>';
      $('retryIndex').addEventListener('click', function () {
        $('indexStatus').textContent = '正在载入完整卡牌索引…';
        loadFullIndex();
      });
    });
    return indexPromise;
  }

  if (!LANG_DATA.zh) {
    $('resultText').textContent = '卡牌数据未能载入，请刷新页面重试。';
  } else {
    activateLang('zh');
    bindEvents();
    if (LANG_DATA.zh.partial) {
      setIndexControls(true);
      var status = document.createElement('p');
      status.id = 'indexStatus';
      status.setAttribute('role', 'status');
      status.textContent = '首批卡牌已就绪，正在载入完整卡牌索引…';
      $('resultText').parentNode.appendChild(status);
      // 先让首屏布局绘制并发出图片请求，再启动后台数据加载。
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          setTimeout(function () {
            if (window.requestIdleCallback) requestIdleCallback(loadFullIndex, { timeout: 1500 });
            else loadFullIndex();
          }, 500);
        });
      });
    }
  }
})();
