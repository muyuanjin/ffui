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

## Coding Style & Naming Conventions

- Use TypeScript and Vue 3 `<script setup>` with 2-space indentation; follow the patterns in existing files.
- Name Vue components in `PascalCase` (e.g. `TranscodingPanel.vue`), variables and functions in `camelCase`.
- In Rust, follow `rustfmt` conventions via `cargo fmt`; use `snake_case` for functions and `SCREAMING_SNAKE_CASE` for constants.

## Testing Guidelines

- Frontend and integration tests are not yet configured; when adding them, prefer colocating tests near code (e.g. `src/components/__tests__`).
- For Rust, add unit tests in the same module and run them with `cargo test` from `src-tauri`.
- Aim for meaningful coverage around transcoding logic and platform-specific behavior, especially any file or process handling.

---
- DATE: 2025-12-02
- CONTEXT: 在 `transcoding` 项目中多次出现“添加任务/拖拽后崩溃”这类低级回归，修复时没有配套前端/后端/接口测试，导致相同类型问题反复出现，用户明确要求把测试纪律写入 AGENTS。
- RULE: 在本项目内，只要改动影响到队列、任务、拖拽、Tauri 调用或 transcoding 逻辑，必须同步补充自动化测试：前端组件/状态测试、Rust 后端单元/集成测试，以及前后端契约测试（至少覆盖关键字段和命令参数）；所有修改在结束任务前必须跑通 `npm test`（或等价前端测试命令）和 `cargo test`，如果某一侧当前无法覆盖，需在答复中说明原因和人工验证步骤。
- ANTI-PATTERN: 不允许“只修代码不写测试”，也不允许在测试失败或尚未运行时就宣布本次问题已解决；更不允许把针对同一接口或字段的不一致问题留到以后再修。

## Commit & Pull Request Guidelines

- Use clear, imperative commit messages (e.g. `feat: add video bitrate preset selector`).
- Keep pull requests focused and small, with a short summary, motivation, and any relevant screenshots for UI changes.
- Reference related issues in the description (e.g. `Closes #12`) and mention any manual testing steps you performed.

## Tauri Window Visibility Guardrails

- Do NOT change `visible` in `src-tauri/tauri.conf.json` from `true` to `false` just to "optimize startup" or "reduce blank window time`.
- The main window MUST stay visible by default unless there is an explicit, implemented, and tested Rust-side "show on ready" flow using the Tauri window APIs (e.g. calling `window.show()` after initialization with a clear fallback or timeout).
- When working on startup performance or blank-window UX, prefer:
  - improving the HTML/CSS boot shell in `index.html`,
  - minimizing blocking work before the first render,
  - lazy-loading non-critical modules,
  instead of hiding the main window.

---
- DATE: 2025-12-02
- CONTEXT: 在本项目里多次擅自把 `src-tauri/tauri.conf.json` 的窗口 `visible` 从 true 改为 false，导致主窗口长时间不出现（几十秒黑着），用户多次强烈抱怨。
- RULE: 在 `transcoding` 项目中，除非 proposal/设计里明确说明并已经实现可靠的 Rust 端 show-on-ready 流程（包括超时兜底），否则一律保持 Tauri 主窗口 `visible: true`，不要再通过修改 visible 来“优化首屏”。
- ANTI-PATTERN: 不要因为想减少空白窗口时间，就直接把 `visible` 改为 false 再靠前端或侥幸来 show；这种做法极易导致启动阶段长时间无窗口可见，是严重 UX 问题。

## Tauri Drag & Drop Guardrails

- Always treat desktop file drag & drop as a 3-layer feature: window config → Tauri events → frontend UI state.
- For this project, **a feature is not “productionized” until it works in a real `npm run tauri dev` session**, with the actual desktop window and real user flows (click “添加任务”、拖文件、看队列变化) verified.
- When editing Tauri config/capabilities:
  - Only use fields and permissions that exist in the current schema / version (e.g. `dragDropEnabled`, `core:event:allow-listen`), never invent names like `fileDropEnabled` or arbitrary `dialog:*` identifiers.
  - After every change to `src-tauri/tauri.conf.json` or `src-tauri/capabilities/*.json`, immediately run `cargo build` from `src-tauri` to catch schema/permission errors early.
- For file drag & drop specifically:
  - Window must have `dragDropEnabled: true` (or equivalent) in `tauri.conf.json` **and** capabilities must allow listening for events before frontend drag UI will ever see anything.
  - Frontend must listen to `tauri://file-drop-hover`, `tauri://file-drop`, `tauri://file-drop-cancelled` and drive `isDragging` / `lastDroppedRoot` / `showSmartScan` instead of依赖纯 DOM 的 `dragover/drop`。
- When calling system UI (dialogs etc.):
  - Prefer official APIs / plugins over brittle globals (e.g. `window.__TAURI__.dialog`), and always design a non-Tauri fallback or mock path for web mode.
  - If a global is used (`withGlobalTauri`), guard for absence and log clear errors instead of silently failing.
- UX complaints like “按钮点了没反应”“拖拽没任何提示”必须被映射到**具体代码路径**来分析：
  - 先查事件是否绑定、再查函数里是否有早退条件（例如路径为空）、再查 Tauri 能力/配置是否缺失。
  - 不允许用“可能是环境问题”来模糊带过。
