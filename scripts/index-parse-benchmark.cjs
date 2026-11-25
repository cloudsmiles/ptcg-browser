// 每个样本使用独立 Node 进程，避免 V8 编译缓存污染解析耗时。
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const baseline = process.argv[2];
if (!baseline) throw new Error('用法：node scripts/index-parse-benchmark.cjs <旧索引路径>');
const program = `
const fs=require('node:fs'),vm=require('node:vm'),{performance}=require('node:perf_hooks');
const source=fs.readFileSync(process.argv[1],'utf8');
const loader=fs.readFileSync('data-loader.js','utf8');
const context=vm.createContext({window:{}});
let start=performance.now(); const script=new vm.Script(source); const compileMs=performance.now()-start;
start=performance.now();script.runInContext(context);const executeMs=performance.now()-start;
start=performance.now();vm.runInContext(loader,context);const hydrateMs=performance.now()-start;
console.log(JSON.stringify({compileMs,executeMs,hydrateMs,totalMs:compileMs+executeMs+hydrateMs}));`;
const report = { date: new Date().toISOString(), note: '独立 Node 进程，非浏览器计时；每组 5 次，避免同进程字节码缓存', groups: {} };
for (const [label, file] of [['before', baseline], ['after', 'data/zh-index.js']]) {
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const result = spawnSync(process.execPath, ['-e', program, file], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr);
    samples.push(JSON.parse(result.stdout));
  }
  report.groups[label] = { bytes: fs.statSync(file).size, samples };
}
fs.writeFileSync('docs/report/index-parse.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
