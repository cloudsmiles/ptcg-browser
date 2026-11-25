# PTCG 卡牌浏览器

安装图片处理依赖后，使用 Python 3 启动：

```sh
python3 -m pip install -r requirements.txt
python3 serve.py
```

访问 http://localhost:8000 。可通过 `--port 8001` 更换端口。

## 自动同步中文数据

项目仓库：https://github.com/cloudsmiles/ptcg-browser

运行环境为 Python 3.11+ 和 Node.js 22+。同步从上游 `duanxr/PTCG-CHS-Datasets` 获取最新提交，固定该提交下载原始 JSON，再转换、构建并逐张校验索引与详情。数据文件超过 CDN 的 20 MB 上限，下载使用 GitHub API 的原始内容响应；图片仍使用 CDN。

```sh
python3 sync_data.py
python3 serve.py --data-dir .sync/data
```

首次执行会下载并构建数据；后续上游和构建规则均未变化时跳过。可以用 `--check` 只检查、`--force` 强制重建，或用 `--state-dir` 指定独立状态目录。网络请求有超时与有限重试；空数据、格式异常、缺少名称或卡牌数量减少超过 10% 时拒绝发布。确认上游确实删除了大量卡牌后才能使用 `--allow-drop`。默认 `.sync/` 不提交 Git。

完整索引及详情使用带版本的地址，发布只在资源完整写入后原子切换首屏入口；旧页面继续使用旧资源。旧资源暂不自动清理。最近检查时间、成功时间、数量及错误保存在状态目录的 `status.json`；同步失败返回非零状态，不覆盖当前入口。

服务器部署和定时同步见 [部署与运维说明](docs/manual_deployment/服务器部署.md)。GitHub Actions 负责离线回归检查；线上数据由服务器每天自动同步，无需手动提交数据或重启网页服务。向 GitHub 推送代码不会自动部署代码，代码更新按运维说明发布。

请使用 `serve.py`，它支持 gzip 压缩、压缩结果缓存和 ETag 条件请求。直接使用 `python3 -m http.server` 不会压缩数据。部署到其他服务器时，请启用 gzip 或 Brotli，并正确设置 `Content-Encoding`、`Vary: Accept-Encoding` 和缓存校验。

## 列表缩略图

列表自动根据像素密度选择 240/480 档 WebP，保持原始比例且不会放大低分辨率原图；详情使用原图。服务从固定卡图仓库下载原图并同时生成两档缩略图，缓存到 `.cache/thumbnails/`。最多 4 个并发下载，同一图片请求会合并；浏览器缓存有效期一年，URL 包含原始仓库版本。

缩略图仅在浏览到卡片并发起图片请求时按需生成，不执行预热。首次未命中缓存需要下载并转换，可能比直接访问 CDN 慢；后续访问使用缓存。磁盘缓存可以删除，删除后将按需重建；目前不自动限制磁盘总量，长期使用可按旧仓库版本清理。缩略图失败时回退原图，并保持无文字的加载占位。

自定义静态托管需提供同样的 `/thumbnails/<仓库版本>/<240或480>/<系列>/<编号>.webp` 文件，或配置到 `serve.py` 的反向代理；否则列表会回退原图。只部署静态页面不会自动生成缩略图。

## 数据构建

首屏仅加载 `data/zh-bootstrap.js`（默认排序前 48 张及系列信息），绘制并发起图片请求后约 500 ms，在浏览器空闲时后台加载 `data/zh-index.js` 完整索引。后台完成前暂时禁用全量搜索、筛选和加载更多，首批卡片与详情可正常浏览；失败时可重试。完成后原位补全列表，不重建首屏节点。搜索文本提前生成；完整详情按需从 `data/zh-details/<版本>/<分片>.json` 加载，每片最多 128 张卡牌，前端最多缓存 8 个分片。列表只渲染视口附近卡片，点击“加载更多”扩大可浏览范围，不会把所有卡片长期挂在页面上。默认排序预先生成，其他排序按需缓存。

修改或重新生成 `data/zh.js` 后运行：

```sh
node scripts/build-browser-data.cjs
```

构建脚本保留原始数据和旧详情版本。发布时需同时部署索引、详情目录、`data-loader.js`、`virtual-grid.js`、`app.js` 和样式，旧版本详情可在旧页面不再访问后清理。卡牌原始 ID 存在重复，详情使用分片内的位置定位，避免覆盖不同卡牌记录。

列表卡图加载中或失败时保留无文字的静态占位背景；卡名等信息仍在图片下方展示，打开详情后可查看完整文字卡面。首次选择某种非默认排序仍需排序，完整搜索文本仍占用一定内存，外部 CDN 卡图速度取决于网络。

## 回归测试

需要 Node.js 和 Python 3，JavaScript 测试无需第三方依赖；Python 测试需要上述 Pillow：

```sh
node --test tests/*.test.cjs
python3 -m unittest discover -s tests -p 'test_*.py'
```

## 真实浏览器性能校验

启动服务后，在临时目录安装测试工具（应用运行不需要这些依赖）：

```sh
npm install --prefix /tmp/ptcg-perf-tools playwright-core@1.65.1
export PLAYWRIGHT_CORE=/tmp/ptcg-perf-tools/node_modules/playwright-core
node scripts/browser-regression.cjs
node scripts/browser-scroll-regression.cjs
node scripts/browser-image-loading.cjs
node scripts/browser-thumbnails.cjs
node scripts/browser-deferred-index.cjs
node scripts/browser-slow-images.cjs
PERF_CHECK=1 node scripts/browser-performance.cjs docs/report/performance-after.json
PERF_CHECK=1 PERF_WIDTH=390 PERF_CPU_RATE=4 node scripts/browser-performance.cjs docs/report/performance-mobile-cpu4.json
```

默认使用 macOS 上安装的 Google Chrome；其他环境通过 `CHROME_PATH` 指定 Chrome/Chromium 可执行文件。可通过 `PERF_URL` 修改测试地址。

真实网络缩略图抽测（不是固定图片基准）：

```sh
node scripts/thumbnail-benchmark.cjs
THUMB_KIND=Pokemon node scripts/thumbnail-benchmark.cjs docs/report/thumbnail-network-pokemon.json
```

索引使用重复字符串字典编码，减少 JS 字面量体积。冷解析对比可在更新索引前保存旧索引，再运行 `node scripts/index-parse-benchmark.cjs <旧索引路径>`；该脚本每组启动 5 个独立 Node 进程，结果不能代替真实浏览器首屏耗时。

性能脚本每种条件运行 3 次，采集首卡片就绪时间、FCP、资源传输量、搜索响应、连续加载 50 次后的 DOM/监听器数量、GC 后 JS 堆和长任务。固定第三方图片响应以隔离 CDN 波动；CPU 4 倍降速仅模拟较弱 CPU，不代表真实手机或弱网。

`PERF_CHECK=1` 启用预算断言：渲染卡片 ≤80、DOM 节点 <6000、监听器 <300、首屏本地资源传输 <1.5 MB、加载更多中位耗时 <50 ms（CPU 降速时按倍率放宽），且没有页面脚本异常。首屏就绪与搜索耗时记录但不设硬阈值，避免将本机调度噪声视为产品回归。

测试结果和条件见 [性能校验报告](docs/report/2026-11-25-性能校验.md)。
