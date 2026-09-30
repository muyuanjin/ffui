# Repository Guidelines

## 通用工作原则

- 以项目原则、指导、约束与流程为准绳，在**更正确且更容易正确的源头**修改：优先修正拥有该关系的层级（域 owner、边界封装、契约定义、门禁脚本），而不是在调用点打补丁或让下游猜测。
- 合理实现提案：解决需求背后的真实问题、遵守项目核心理念，而不是死板照搬字面要求。当存在既更简单、又更正确、也更容易保持正确的方案时，采用该方案，并在同一改动里说明它取代了什么。
- 编写高阶优化的代码：让违规状态在适用范围内无法产生，保留合法反例，不为覆盖未来调用者而破坏不受约束的用途。
- 对项目内持久化的文本（代码注释、JSDoc、README、文档、发布说明、`.agents/skills/**`）：**既不范畴混淆，也不泄露思考过程**。
  - 范畴混淆（把上层话语、协商过程、执行细节搬进产物）按 [`.agents/skills/meta-layer-guard/SKILL.md`](.agents/skills/meta-layer-guard/SKILL.md) 处理。
  - CoT 泄露按 [`.agents/skills/trim-cot-leakage/SKILL.md`](.agents/skills/trim-cot-leakage/SKILL.md) 处理。
- 规则载体分工：本文件承载长期规则；[docs/review-before-push.md](docs/review-before-push.md) 承载推送前 review 的机制；`.agents/skills/**` 承载可复用方法论；`releases/*.md` 承载面向用户的变化说明。
- 上面两节是本仓库自己的长期规则，clone 或换一个 harness 仍然生效。与跨项目共享指引重叠的条目是为了让本仓库自足，不额外增加约束；有分歧时以本文件的表述为准。
- 新增 `.agents/skills/<name>/` 时必须同时在 `.gitignore` 放行该目录，否则它只在当前 checkout 里存在、clone 后消失，而本机 skill provider 仍能发现它，作者不会察觉。

## 通用工程约束

- **证据分层**：代码与测试确立当前行为，文档确立契约，运行记录只说明当次条件，用户反馈说明需求。不要让一种证据冒充另一种；来源冲突时先确认谁拥有该契约，再更新其受影响的下游。
- **失败归因到 owner**：同类失败反复出现时沿语义 owner 追。合规输入按既有规则走仍然违约，就修正规则或表示本身，并让下游从同一 owner 获得正确行为，而不是在各处累积例外。
- **显式优于隐式**：默认值必须是拥有该关系的实现里显式的解析步骤，不能是调用深处隐藏的 `?? default`。
- **配置错误要响亮**：自包含的在加载时失败，否则在最早可解析处失败；绝不静默跳过缺失的引用。
- **在正确的边界校验**：类型系统已能保证的同进程边界不要加运行时校验；校验放在解析/配置、IPC、文件、进程与线上边界。
- **空 `catch` 必须说明它吞掉了什么、为什么其它路径到不了这里**；`try` 只包一条语句。
- **注释与诊断只写契约、归属、失败与恢复后果**，不写评审讨论、实现日记或本地执行记录。
- 不为代码里显而易见的事实写注释；并行的值保持对称——无法解释的不对称通常意味着漏了一次抽取。
- **测试描述行为，而不是正确性**：行为变更与它的测试一起改，并在 PR 里说明为什么。
- **PR 历史要有意识**：独立改动拆开；重写用 `--force-with-lease`，远端移动即中止，绝不用裸 `--force`。

## Project Structure & Module Organization

- Frontend source lives in `src` (Vue 3 + TypeScript); shared assets are under `src/assets`.
- Tauri (Rust) backend lives in `src-tauri/src`, with configuration in `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`.
- Static files such as the base HTML shell are in `public` and `index.html`.

## Main App 架构硬纪律（必须长期保持）

- `src/MainApp.vue` 只允许做薄别名入口（兼容层），不得承载领域装配或大规模透传。
- `src/MainApp.impl.vue` 只负责创建 MainApp domains、通过 domain-scoped DI 进行 `provide`，然后挂载 `src/components/main/MainAppRootShell.vue`；不得在此处做跨域业务协调。
- `src/MainApp.setup.ts` 只能作为薄 context 入口和兼容层；不得直接创建 queue/presets/settings/media 等领域模块，不得通过 `as MainAppQueueTabModule` 或 `queue.xxx = ...` 这类“先断言后补字段”的方式装配 domain。
- MainApp 域 hooks（`useQueueDomain()` / `usePresetsDomain()` 等）必须直接注入各自的 domain key；`useMainAppContext()` 只允许作为兼容 adapter，不得作为域 hooks 的实现基础。
- `src/components/main/MainAppRootShell.vue` / `src/components/main/**/*Host.vue` / `src/components/main/**/*Shell.vue` 必须是装配层：只 `v-bind/v-on`，不得直接拼装跨域业务逻辑。
- Host/Shell 组件不得直接导入 MainApp 域 hooks 或 `useMainAppContext()`；跨域协调必须收敛到 `src/composables/main-app/orchestrators/**`。
- UI 层（`src/components/**`）不得直接消费“全局 context bag”（禁止直接 `useMainAppContext()`）；必须使用域 hooks 或 orchestrators。
- Tauri `invoke` 不得在业务代码中直接使用；必须通过 `src/lib/backend/invokeCommand.ts` 统一封装（契约/校验/测试集中在此边界）。
- 上述纪律必须由门禁固化（例如 `eslint.config.js` 的 `no-restricted-imports`、以及对应回归测试），禁止仅靠口头约定。

**维护要求**：若项目结构/文件路径/门禁策略/装配方式发生变动（例如 RootShell/Host 命名调整、域 hooks 入口迁移、orchestrators 目录重组），必须在同一改动中同步更新本节文字与对应的 ESLint/测试门禁，保证记录与实际一致。

## Build, Test, and Development Commands

- `corepack enable && pnpm install` — install all JavaScript and Tauri CLI dependencies.
- `pnpm run dev` — start the Vite dev server for the web frontend only.
- `pnpm run tauri:dev` — run the full Tauri desktop app in development mode.
- `pnpm run build` — type-check with `vue-tsc` and build the production frontend bundle.
- From `src-tauri`, use `cargo check` and `cargo build` to validate and build the Rust backend.
- In WSL with the Windows-forwarded Cargo shim, avoid bare full-suite `cargo test`; it can hang under the default parallel harness. Use the project gate (`pnpm run check:all`) or run Rust tests as `cargo test --profile check-all --target-dir target/win -- --test-threads=1`.
- When `pnpm run check:all` fails, read the printed `.cache/check-all/logs/<run>/NN_*.log` file first; it usually points to the exact failing subcheck.
- Do NOT run `pnpm run test:watch` from agents, as it starts Vitest in interactive watch mode and can hang; instead, use non-interactive commands such as `pnpm vitest run src/__tests__/MainApp.queue-sorting.basic.spec.ts` (or another focused `pnpm vitest run` invocation) as the "equivalent frontend test command" required by this spec.

## Release Guidelines

- Every release tag `vX.Y.Z` MUST ship with a committed bilingual release note at `releases/vX.Y.Z.md`.
  - The file MUST include both `## English` and `## 中文` sections.
  - Release notes SHOULD be user-facing summaries (not raw commit logs), and the EN/ZH content MUST be consistent.
- Use `node scripts/generate-release-notes.mjs vX.Y.Z vA.B.C > releases/vX.Y.Z.md` to scaffold, then rewrite into a polished bilingual note before tagging.
- The release workflow reads `releases/${tag}.md` and fails fast if it is missing or not bilingual, to prevent publishing releases with placeholder notes.
- 说明按用户可观察性排序（可用性 → 行为变化 → 修复 → 升级要求），只写产品事实，不写作者时间戳、验证叙述或内部交付流程。

## Coding Style & Naming Conventions

- Use TypeScript and Vue 3 `<script setup>` with 2-space indentation; follow the patterns in existing files.
- Name Vue components in `PascalCase` (e.g. `TranscodingPanel.vue`), variables and functions in `camelCase`.
- In Rust, follow `rustfmt` conventions via `cargo fmt`; use `snake_case` for functions and `SCREAMING_SNAKE_CASE` for constants.

## Rust：未使用变量/返回值处理（避免“下划线消音”）

- 优先删除无用变量/调用；不要把历史遗留的 unused 通过改名或前导 `_`“消音”长期保留。
- 对 `Result<T, E>` / `#[must_use]` 返回值：优先 `?` / `match` / `if let Err(err) = ... { ... }`；若明确要忽略，用 `drop(expr)`（必要时配一句 “best-effort” 的原因），不要写 `let _ = expr` / `let _unused = expr` / `let _removed = expr`。
- 对 `windows`/Win32 的 `BOOL` 等 `Copy` 且 `#[must_use]` 返回值：用 `.as_bool()` 消费结果（例如 `ShowWindow(hwnd, SW_SHOW).as_bool();`）；不要对它 `drop(...)`（会触发 `clippy::drop_copy`）。
- 仅在需要延长生命周期/作用域时才保留 `_guard` 这类绑定；否则用更小作用域 `{ ... }` 或显式 `drop(guard)`。

## i18n 运行时切换（高频踩坑）

- 任何“下拉/选择器触发器”里的**已选项文本**，不要依赖组件内部缓存；必须在触发器里显式渲染 `t(...)`（例如给 `SelectValue` 提供插槽文本）。
- 若组件无法显式渲染（或第三方组件强缓存），可用 `:key="locale"` 作为兜底强制重挂载，但要评估是否会丢失局部交互状态。
- 涉及此类文本的修复必须补齐验证：Vitest 覆盖“切换 locale 后文本立刻更新”，并提供可复用的 Playwright 截图脚本做回归。

## Batch Compress 持久化/恢复纪律

- Batch Compress 的运行期 batch metadata（如 `BatchCompressBatch` / `batch_compress_batches`）不会随队列持久化完整保存；任何会影响子任务实际输出语义的配置，必须同时写入 job 级持久化快照，确保 restart / crash recovery 后不回落到默认配置。
- `BatchCompressSavingCondition` 除 saving gate 外，也承载图片/音频 Batch Compress 子任务恢复执行所需的轻量快照；新增 `u64`/`Option<u64>` 字段时必须带 `specta_typescript::Number<u64>` 标注，并运行 `pnpm run check:queue-contracts:update`。

## Testing Guidelines

- Frontend tests are configured via Vitest and live primarily under `src/__tests__`; keep new tests near code when practical (e.g. `src/components/__tests__`).
- For Rust, add unit tests in the same module and run them with `cargo test` from `src-tauri`.
- Aim for meaningful coverage around transcoding logic and platform-specific behavior, especially any file or process handling.

- RULE: 在本项目内，只要改动影响到队列、任务、拖拽、Tauri 调用或转码（transcoding）逻辑，必须同步补充自动化测试：前端组件/状态测试、Rust 后端单元/集成测试，以及前后端契约测试（至少覆盖关键字段和命令参数）；所有修改在结束任务前必须跑通 `pnpm test`（或等价前端测试命令）和 Rust 测试（WSL/Windows-forwarded Cargo 下用 `cargo test --profile check-all --target-dir target/win -- --test-threads=1` 或由 `pnpm run check:all` 覆盖）；
- 每次功能完成或提交前必须保证 `pnpm run check:all` 通过。
- ANTI-PATTERN: 不允许“只修代码不写测试”，也不允许在测试失败或尚未运行时就宣布本次问题已解决；更不允许把针对同一接口或字段的不一致问题留到以后再修。

## Commit & Pull Request Guidelines

- Use clear, imperative commit messages (e.g. `feat: add video bitrate preset selector`).
- Keep pull requests focused and small, with a short summary, motivation, and any relevant screenshots for UI changes.
- Reference related issues in the description (e.g. `Closes #12`) and mention any manual testing steps you performed.

## 推送前独立 review（硬门禁）

- `git push` 由 `.husky/pre-push` 强制：没有与待推送内容绑定的 review proof 一律拒绝，**没有豁免**（缺 plan、缺台账、缺 proof、纯文档改动都不例外）。
- `REVIEW_PLAN.json` 与 `REVIEW_FINDINGS.md` 是 checkout-local 状态，**永不提交**（见 `.gitignore`）。
- 计划按**语义职责**（不是文件数量）划分车道；base 以来变更的每个路径必须属于至少一个车道。车道声明 scope/paths/dependsOn/obligations/owners/consumers/counterexamples，并给出一个能否证它的判别性反例。
- 结论绑定「车道输入内容指纹 + 计划哈希」；输入或计划变化即失效，需重跑该车道及其依赖闭包，未受影响的车道结论继续有效。
- 独立 reviewer 只拿到该车道的语义边界与项目上下文，不拿实施者的结论；证据报告必须以 `VERDICT: NO FINDINGS` / `FINDINGS` / `INCOMPLETE` 结尾，后两者不是 clean 证据。
- 顺序：`review:plan:new` / `review:findings:new` → 填车道 → `review:plan -- --base <commit>` → 逐车道 `review:lane` → `review:gate`（干净工作树跑 `check:all`）→ `review:finalize` → `git push`。
- 证据格式、差异说明与锁恢复见 [docs/review-before-push.md](docs/review-before-push.md)；改动本机制时同步更新该文档与 `scripts/review.mjs`。
