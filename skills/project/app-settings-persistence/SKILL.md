---
name: app-settings-persistence
description: 在 FFUI 项目里新增/修改任何需要“跨重启保存”的设置字段（AppSettings / settings.json），或遇到“UI 状态能切换但重启后丢失/回滚”的问题时，使用本技能按前端+后端+契约测试的顺序补齐持久化链路，避免只改前端导致字段被后端丢弃。
---

# App Settings Persistence

## 目标

让一个新的“可持久化设置字段”在 FFUI 中端到端可靠保存：Vue/TS ↔ Tauri invoke ↔ Rust AppSettings ↔ settings.json，并用测试锁死回归。

## 必做清单（按顺序）

1. 前端类型与读写

- 在 `src/types/settings.ts` 的 `AppSettings` 增加字段（camelCase，例如 `presetSelectionBarPinned?: boolean;`）。
- 在产生/读取该字段的地方只从 `settings.appSettings.value` 读，写入时更新 `settings.appSettings.value = nextSettings`（参考 `src/composables/main-app/useMainAppSetup.ts` 的 `setSelectionBarPinned` 模式）。

2. 后端 settings 结构体（最常漏）

- 在 `src-tauri/src/ffui_core/settings/types.rs` 的 `AppSettings` 增加对应字段（snake_case，例如 `preset_selection_bar_pinned: bool`）。
- 依赖现有 `#[serde(default, rename_all = "camelCase")]`，确保 JSON 键名为 camelCase。
- 选择合适的 serde 规则：
  - `bool` 默认 `false`：`#[serde(default, skip_serializing_if = "types_helpers::is_false")]`
  - `Option<T>`：`#[serde(skip_serializing_if = "Option::is_none")]`
- 同步更新 `impl Default for AppSettings`，保证默认值明确且不会触发序列化噪音。

3. 契约与回归测试（必须同时有前后端）

- 前端契约：更新 `src/__tests__/backend.settings-contract.spec.ts`，确保 `save_app_settings` payload 中包含该字段，并能从 `get_app_settings` 读回。
- 后端 round-trip：在 `src-tauri/src/ffui_core/settings/tests/` 新增/更新一个 decode→encode 测试，确保 JSON 字段不被丢弃（参考 `tests_selection_bar_pinned.rs` 的写法）。
- 注意 `src-tauri` 有后端行数门禁：单个源码文件阈值 500 行；加字段时优先压缩注释/避免多余空行。

4. 运行验证

- 运行 `pnpm test`
- 运行 `cargo test`（在 `src-tauri` 下）

## 典型故障定位（“看起来写了，但没保存”）

- 重启后 UI 回到默认值：高概率是后端 `AppSettings` 缺字段/命名不匹配，导致保存时被忽略、加载时也读不到。
- `pnpm test` 通过但 `cargo test` 失败：先看 `src-tauri/tests/line_length_guard.rs` 是否提示超行，再看 settings round-trip 测试是否缺失。

## 最小示例（新增一个 bool 开关）

- TS：`src/types/settings.ts` 加 `myFlag?: boolean`
- Rust：`src-tauri/src/ffui_core/settings/types.rs` 加 `my_flag: bool` + `#[serde(default, skip_serializing_if = "types_helpers::is_false")]`
- Tests：各加一个“能保存能读回”的断言（前端契约 + 后端 round-trip）
