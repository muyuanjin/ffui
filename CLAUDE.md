# CLAUDE.md

This file provides guidance to Claude Code when working in this repository. Keep it aligned with `AGENTS.md`; if they diverge, update both in the same change.

## Project snapshot

- FFUI is a Tauri 2 desktop transcoding app with a Vue 3 + TypeScript frontend and a Rust backend.
- Frontend source lives under `src/`; Rust backend lives under `src-tauri/src/`.
- Shared static assets are under `public/`; release notes live under `releases/`.

## Architecture guardrails

- `src/MainApp.vue` must remain a thin alias entry only.
- `src/MainApp.impl.vue` may only create/provide MainApp domains and mount `src/components/main/MainAppRootShell.vue`.
- `src/MainApp.setup.ts` is a thin context/compatibility layer. Do not assemble queue/presets/settings/media domains there.
- Domain hooks (`useQueueDomain()`, `usePresetsDomain()`, etc.) must inject their own domain keys directly. `useMainAppContext()` is compatibility-only.
- `src/components/main/**/*Host.vue` and `src/components/main/**/*Shell.vue` are assembly layers only; cross-domain coordination belongs in `src/composables/main-app/orchestrators/**`.
- UI components under `src/components/**` must not consume the global MainApp context bag directly.
- Do not call Tauri `invoke` directly in app code. Use `src/lib/backend/invokeCommand.ts`.
- These rules are enforced in `eslint.config.js`; keep the lint guardrails in sync with any structural change.

## Commands

```bash
corepack enable
pnpm install

pnpm run dev
pnpm run tauri:dev
pnpm run build
pnpm test
pnpm run check:all

cd src-tauri && cargo check
cd src-tauri && cargo test
```

Do not run `pnpm run test:watch` from agents. Use a non-interactive Vitest command instead, for example `pnpm vitest run src/__tests__/MainApp.queue-sorting.basic.spec.ts`.

## Testing requirements

- If a change touches queue/jobs/drag-and-drop/Tauri invoke/transcoding logic, add or update:
  - frontend component/state tests,
  - Rust unit/integration tests,
  - frontend/backend contract tests for key fields or command payloads.
- Do not declare the task done before running the relevant frontend tests and `cargo test`.
- Before finishing or committing, `pnpm run check:all` must pass.

## Repo-specific notes

- Release tag `vX.Y.Z` must ship with `releases/vX.Y.Z.md`, and that file must contain both `## English` and `## 中文`.
- For i18n-trigger text in selectors/dropdowns, render translated selected text explicitly in the trigger; do not rely on cached internal labels.
