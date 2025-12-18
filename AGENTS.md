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

## Build, Test, and Development Commands

- `npm install` — install all JavaScript and Tauri CLI dependencies.
- `npm run dev` — start the Vite dev server for the web frontend only.
- `npm run tauri dev` — run the full Tauri desktop app in development mode.
- `npm run build` — type-check with `vue-tsc` and build the production frontend bundle.
- From `src-tauri`, use `cargo check` and `cargo build` to validate and build the Rust backend.
- Do NOT run `npm test` directly from agents, as it starts Vitest in interactive watch mode and can hang; instead, use non-interactive commands such as `npx vitest src/__tests__/MainApp.queue-sorting-and-filters.spec.ts` (or another focused `npx vitest` invocation) as the "equivalent frontend test command" required by this spec.

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

## i18n 运行时切换（高频踩坑）

- 任何“下拉/选择器触发器”里的**已选项文本**，不要依赖组件内部缓存；必须在触发器里显式渲染 `t(...)`（例如给 `SelectValue` 提供插槽文本）。
- 若组件无法显式渲染（或第三方组件强缓存），可用 `:key="locale"` 作为兜底强制重挂载，但要评估是否会丢失局部交互状态。
- 涉及此类文本的修复必须补齐验证：Vitest 覆盖“切换 locale 后文本立刻更新”，并提供可复用的 Playwright 截图脚本做回归。

## Testing Guidelines

- Frontend and integration tests are not yet configured; when adding them, prefer colocating tests near code (e.g. `src/components/__tests__`).
- For Rust, add unit tests in the same module and run them with `cargo test` from `src-tauri`.
- Aim for meaningful coverage around transcoding logic and platform-specific behavior, especially any file or process handling.

---

- DATE: 2025-12-02
- CONTEXT: 在 FFUI 项目中多次出现“添加任务/拖拽后崩溃”这类低级回归，修复时没有配套前端/后端/接口测试，导致相同类型问题反复出现，用户明确要求把测试纪律写入 AGENTS。
- RULE: 在本项目内，只要改动影响到队列、任务、拖拽、Tauri 调用或转码（transcoding）逻辑，必须同步补充自动化测试：前端组件/状态测试、Rust 后端单元/集成测试，以及前后端契约测试（至少覆盖关键字段和命令参数）；所有修改在结束任务前必须跑通 `npm test`（或等价前端测试命令）和 `cargo test`，如果某一侧当前无法覆盖，需在答复中说明原因和人工验证步骤。
- ANTI-PATTERN: 不允许“只修代码不写测试”，也不允许在测试失败或尚未运行时就宣布本次问题已解决；更不允许把针对同一接口或字段的不一致问题留到以后再修。

## Commit & Pull Request Guidelines

- Use clear, imperative commit messages (e.g. `feat: add video bitrate preset selector`).
- Keep pull requests focused and small, with a short summary, motivation, and any relevant screenshots for UI changes.
- Reference related issues in the description (e.g. `Closes #12`) and mention any manual testing steps you performed.
