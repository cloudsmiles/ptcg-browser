/* Parse TCGdex cards-database TypeScript source files into plain JSON. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = '/tmp/tcgdb/cards-database-master';

function evalTs(file, globals) {
  let src = fs.readFileSync(file, 'utf8');
  src = src.replace(/^import[^\n]*\n/gm, '');
  src = src.replace(/(const\s+\w+)\s*:\s*\w+\s*=/, '$1 =');
  src = src.replace(/export default\s+(\w+)\s*;?\s*$/m, 'module.exports = $1;');
  try {
    const moduleObj = { exports: {} };
    const fn = new Function('serie', 'Set', 'module', 'exports',
      src + '\nreturn module.exports;');
    return fn((globals || {}).serie, (globals || {}).Set, moduleObj, {});
  } catch (e) {
    return null;
  }
}

function localize(v, langs) {
  if (v == null) return '';
  if (typeof v !== 'object') return String(v);
  for (const l of langs) if (v[l]) return String(v[l]);
  const keys = Object.keys(v);
  return keys.length ? String(v[keys[0]]) : '';
}

function readDirs(base) {
  return fs.readdirSync(base, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.'))
    .map(d => d.name);
}

function readTsFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.ts')).map(f => path.join(dir, f));
}

function parseRegion(region, langs) {
  const regionRoot = path.join(ROOT, region);
  const series = {};
  for (const file of readTsFiles(regionRoot)) {
    const obj = evalTs(file, {});
    if (obj && obj.id) series[path.basename(file, '.ts')] = obj;
  }

  const sets = {};
  const setByFolder = {};
  for (const sDir of readDirs(regionRoot)) {
    const serieName = sDir;
    const serie = series[serieName] || {};
    for (const file of readTsFiles(path.join(regionRoot, sDir))) {
      const obj = evalTs(file, { serie });
      if (!obj || !obj.id) continue;
      const folder = path.basename(file, '.ts');
      obj._serieId = serie.id || serieName;
      sets[obj.id] = obj;
      setByFolder[region + '|' + sDir + '|' + folder] = obj;
    }
  }

  const cards = [];
  let failed = 0;
  for (const sDir of readDirs(regionRoot)) {
    const serie = series[sDir] || {};
    for (const setFolder of readDirs(path.join(regionRoot, sDir))) {
      const setObj = setByFolder[region + '|' + sDir + '|' + setFolder];
      if (!setObj) continue;
      for (const file of readTsFiles(path.join(regionRoot, sDir, setFolder))) {
        const localId = path.basename(file, '.ts');
        const card = evalTs(file, { Set: function () {} });
        if (!card) { failed++; continue; }
        card._setId = setObj.id;
        card._serieId = setObj._serieId;
        card._localId = localId;
        card._region = region;
        card._langs = langs;
        cards.push(card);
      }
    }
  }
  console.log(`${region}: ${Object.keys(sets).length} sets, ${cards.length} cards, ${failed} parse failures`);
  return { series, sets, cards };
}

const region = process.argv[2] || 'data';
const langs = region === 'data' ? ['en'] : ['zh-cn', 'zh-tw', 'ja'];
const result = parseRegion(region, langs);
const out = region === 'data' ? '/tmp/ptcg-repo-en.json' : '/tmp/ptcg-repo-asia.json';
fs.writeFileSync(out, JSON.stringify(result));
console.log('written', out);
