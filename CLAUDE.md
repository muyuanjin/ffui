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

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

FFUI 是一个基于 Tauri 2 的桌面转码应用，结合 Rust 后端和 Vue 3 前端。核心功能：视频/图像批量转码、队列管理、预设统计、输入/输出帧对比、系统性能监控。

## 常用开发命令

```bash
# 开发（推荐）
npm run tauri:dev          # 启动 Tauri 开发模式（会先构建前端）
npm run dev                # 仅启动前端开发服务器 (localhost:5188)

# 构建
npm run build              # 构建前端（含 vue-tsc 类型检查）
npm run build:exe          # 构建可执行文件（不打包安装程序）
npm run tauri build        # 完整构建（含安装包）

# 测试与检查
npm run test               # 运行前端测试 (Vitest)
npm run check:all          # 运行所有检查（推荐提交前执行）
cd src-tauri && cargo test # Rust 测试
cd src-tauri && cargo clippy # Rust lint

# 格式化
npm run format             # Prettier 格式化前端代码
npm run format:rust        # rustfmt 格式化 Rust 代码
```

## 项目结构

```
src/                       # Vue 3 前端
├── components/            # UI 组件（panels/, ui/, dialogs/）
├── composables/           # 状态与逻辑钩子（队列操作、智能扫描、监控等）
├── lib/                   # 工具函数（backend.ts 封装所有 Tauri 调用）
├── locales/               # i18n 资源（en.json, zh-CN.json）
└── types.ts               # TypeScript 类型定义

src-tauri/src/             # Rust 后端
├── ffui_core/             # 核心业务逻辑
│   ├── domain.rs          # 数据模型（与前端 types.ts 对应）
│   ├── engine.rs          # 转码引擎
│   ├── presets.rs         # 预设管理
│   ├── settings.rs        # 应用设置
│   └── tools/             # 外部工具管理（FFmpeg 等）
├── commands/              # Tauri 命令（暴露给前端的 API）
├── system_metrics.rs      # 系统性能采样
├── taskbar_progress.rs    # Windows 任务栏进度
└── lib.rs                 # 应用初始化与命令注册
```

## 核心架构

### 前后端通信

1. **命令调用**: `src/lib/backend.ts` → `src-tauri/src/commands/*.rs`
   - 通过 `invoke()` 调用，数据经 JSON 序列化
2. **事件推送**: Rust `AppHandle::emit()` → 前端监听
   - `queue-update`: 队列状态变更
   - `system-metrics://update`: 性能监控数据
3. **文件协议**: `asset://` 用于本地文件访问（视频预览等）

### 类型同步

- Rust: `src-tauri/src/ffui_core/domain.rs`
- TypeScript: `src/types.ts`
- 使用 `#[serde(rename_all = "camelCase")]` 处理命名转换

### 转码引擎

- 单例 `TranscodingEngine`（`Arc<Mutex<>>`）
- 队列管理（`VecDeque`）+ 并发控制（可配置）
- 解析 FFmpeg stderr 获取进度

## 开发注意事项

### 必须同步的文件

修改 Rust 数据模型（`domain.rs`）后，需同步更新 `src/types.ts`

### Windows 特性

- **权限降级** (`elevation_shim.rs`): 管理员权限下自动重启为普通用户（确保拖放功能）
- **任务栏进度** (`taskbar_progress.rs`): 通过 `windows` crate 实现
- **隐藏控制台**: FFmpeg 使用 `CREATE_NO_WINDOW` 标志

### 外部工具

应用自动下载 FFmpeg/FFprobe/avifenc 到应用数据目录，也支持手动指定路径

## 提交前检查

```bash
npm run check:all  # 或分步执行：
npm run build && npm run test
cd src-tauri && cargo clippy && cargo test
```

### Rust 库名称

库名为 `ffui_lib`（非 `ffui`），以避免与二进制名冲突（Windows Cargo 问题）
