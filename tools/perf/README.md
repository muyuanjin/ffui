# 性能门禁（Queue）

本目录用于**真实浏览器**下的队列性能回归检测，目标是防止“1000 任务 + 少量并行转码 + 高频进度更新”场景再次退化到无法流畅滚动。

## 必跑门禁

- `pnpm bench:queue:browser:gate` -（可选）规模门禁：`pnpm bench:queue:browser:scale:gate` -（强烈建议）长跑门禁（专门卡死“反复滚动后退化/heap 增长”）：`pnpm bench:queue:browser:long:gate`

该门禁覆盖：

- `--jobs 1000 --processing-jobs 2 --tick-ms 100`
- `sortPrimary=progress/elapsed`（desc）
- `sortPrimary=addedTime`（processing 也必须流畅）
- `progressStyle=bar/ripple-card/card-fill`
- 队列缩略图加载（perf 场景下由 docs-screenshots dev server 提供 `/__ffui_perf__/thumb.bmp`，用于覆盖预览图解码/绘制压力）
- `全暂停纯滚动`：`--processing-jobs 0 --paused-jobs 1000 --tick-ms 0`
- `icon view`：`--modes icon-small,icon-medium`
- `预览图压力`：`--preview-mode missing-auto-ensure --ensure-preview-delay-ms 30`
- `--assert`：默认阈值 `minFps=55`、`maxLagP95Ms=20`、`maxDomRows=120`、`maxDomIconRows=180`

## 手动调参/排查

- `pnpm bench:queue:browser --help`
- 规模对比（同配置跑 1000/1万/10万）：`pnpm bench:queue:browser:scale` 或 `pnpm bench:queue:browser --jobs-list 1000,10000,100000 ...`
- 长跑/分段统计：`pnpm bench:queue:browser --segments 6 --duration-ms 60000 ...`（输出每段 fps/lag 与 heap 采样）
- 后端增量聚合基准（用于确认 O(patches) 而非 O(N)）：`cargo run --manifest-path src-tauri/Cargo.toml --features bench --bin bench_taskbar_progress_delta -- --jobs-list 1000,10000,100000 --processing-jobs 2 --ticks 5000`
  - 期望：`avg_apply_delta` 在 1k→100k 规模下保持同数量级，且 100k/1k 的比值不应接近线性增长（经验阈值：≤ 2x）。
- 例：`pnpm bench:queue:browser --assert --jobs 1000 --processing-jobs 2 --tick-ms 100 --sort-primary progress --sort-primary-direction desc`
- 例（不发后端增量事件，隔离纯前端滚动）：`pnpm bench:queue:browser --assert --jobs 1000 --processing-jobs 0 --paused-jobs 1000 --tick-ms 0 --modes detail,icon-small`
- 例（模拟“缺失预览图 + 自动生成 + cache-bust”）：`pnpm bench:queue:browser --assert --jobs 1000 --processing-jobs 0 --paused-jobs 1000 --tick-ms 0 --preview-mode missing-auto-ensure --ensure-preview-delay-ms 30 --modes detail,icon-small`
