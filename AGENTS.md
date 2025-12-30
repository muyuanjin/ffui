<!-- OPENSPEC:START -->

# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:

- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:

- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->

# Repository Guidelines

## Project Structure & Module Organization

- Frontend source lives in `src` (Vue 3 + TypeScript); shared assets are under `src/assets`.
- Tauri (Rust) backend lives in `src-tauri/src`, with configuration in `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`.
- Static files such as the base HTML shell are in `public` and `index.html`.

## Main App 架构硬纪律（必须长期保持）

- `src/MainApp.vue` 只允许做薄别名入口（兼容层），不得承载领域装配或大规模透传。
- `src/MainApp.impl.vue` 只负责创建并 `provide` AppContext，然后挂载 `src/components/main/MainAppRootShell.vue`；不得在此处做跨域业务协调。
- `src/components/main/MainAppRootShell.vue` / `src/components/main/**/*Host.vue` / `src/components/main/**/*Shell.vue` 必须是装配层：只 `v-bind/v-on`，不得直接拼装跨域业务逻辑。
- Host/Shell 组件不得直接导入 MainApp 域 hooks 或 `useMainAppContext()`；跨域协调必须收敛到 `src/composables/main-app/orchestrators/**`。
- UI 层（`src/components/**`）不得直接消费“全局 context bag”（禁止直接 `useMainAppContext()`）；必须使用域 hooks 或 orchestrators。
- Tauri `invoke` 不得在业务代码中直接使用；必须通过 `src/lib/backend/invokeCommand.ts` 统一封装（契约/校验/测试集中在此边界）。
- 上述纪律必须由门禁固化（例如 `eslint.config.js` 的 `no-restricted-imports`、以及对应回归测试），禁止仅靠口头约定。

**维护要求**：若项目结构/文件路径/门禁策略/装配方式发生变动（例如 RootShell/Host 命名调整、域 hooks 入口迁移、orchestrators 目录重组），必须在同一改动中同步更新本节文字与对应的 ESLint/测试门禁，保证记录与实际一致。

## Build, Test, and Development Commands

- `corepack enable && pnpm install` — install all JavaScript and Tauri CLI dependencies.
- `pnpm run dev` — start the Vite dev server for the web frontend only.
- `pnpm run tauri dev` — run the full Tauri desktop app in development mode.
- `pnpm run build` — type-check with `vue-tsc` and build the production frontend bundle.
- From `src-tauri`, use `cargo check` and `cargo build` to validate and build the Rust backend.
- Do NOT run `pnpm run test:watch` from agents, as it starts Vitest in interactive watch mode and can hang; instead, use non-interactive commands such as `pnpm vitest run src/__tests__/MainApp.queue-sorting-and-filters.spec.ts` (or another focused `pnpm vitest run` invocation) as the "equivalent frontend test command" required by this spec.

## Release Guidelines

- Every release tag `vX.Y.Z` MUST ship with a committed bilingual release note at `releases/vX.Y.Z.md`.
  - The file MUST include both `## English` and `## 中文` sections.
  - Release notes SHOULD be user-facing summaries (not raw commit logs), and the EN/ZH content MUST be consistent.
- Use `node scripts/generate-release-notes.mjs vX.Y.Z vA.B.C > releases/vX.Y.Z.md` to scaffold, then rewrite into a polished bilingual note before tagging.
- The release workflow reads `releases/${tag}.md` and fails fast if it is missing or not bilingual, to prevent publishing releases with placeholder notes.

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

## Testing Guidelines

- Frontend and integration tests are not yet configured; when adding them, prefer colocating tests near code (e.g. `src/components/__tests__`).
- For Rust, add unit tests in the same module and run them with `cargo test` from `src-tauri`.
- Aim for meaningful coverage around transcoding logic and platform-specific behavior, especially any file or process handling.

## Project Skills（项目级技能指引）

- 本仓库的项目级 skills 放在 `skills/project/`；每个 skill 是一个独立目录，至少包含 `SKILL.md`。
- 当项目行为/约定发生变化（尤其是“持久化/设置/契约”相关），必须同步更新对应的 `skills/project/*/SKILL.md`，保证步骤、关键文件路径、测试门禁仍然准确；后续新增更多项目级 skills 时，也在此处登记。
- 已有 skills：
  - `app-settings-persistence`：新增/修改 `AppSettings`（settings.json）字段的端到端持久化清单与测试要求（`skills/project/app-settings-persistence/SKILL.md`）。

---

- DATE: 2025-12-02
- CONTEXT: 在 FFUI 项目中多次出现“添加任务/拖拽后崩溃”这类低级回归，修复时没有配套前端/后端/接口测试，导致相同类型问题反复出现，用户明确要求把测试纪律写入 AGENTS。
- RULE: 在本项目内，只要改动影响到队列、任务、拖拽、Tauri 调用或转码（transcoding）逻辑，必须同步补充自动化测试：前端组件/状态测试、Rust 后端单元/集成测试，以及前后端契约测试（至少覆盖关键字段和命令参数）；所有修改在结束任务前必须跑通 `pnpm test`（或等价前端测试命令）和 `cargo test`，如果某一侧当前无法覆盖，需在答复中说明原因和人工验证步骤。
- ANTI-PATTERN: 不允许“只修代码不写测试”，也不允许在测试失败或尚未运行时就宣布本次问题已解决；更不允许把针对同一接口或字段的不一致问题留到以后再修。

## Commit & Pull Request Guidelines

- Use clear, imperative commit messages (e.g. `feat: add video bitrate preset selector`).
- Keep pull requests focused and small, with a short summary, motivation, and any relevant screenshots for UI changes.
- Reference related issues in the description (e.g. `Closes #12`) and mention any manual testing steps you performed.
