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

FFUI 是一个基于 Tauri 的桌面转码应用程序，结合了 Rust 后端和 Vue 3 前端。主要功能包括：
- 视频/图像转码（支持 H.264、HEVC、AV1、AVIF 等编码）
- 智能扫描和批量转码
- 队列管理（支持并发控制、暂停/恢复）
- 系统监控（CPU/GPU 使用率）
- FFmpeg 参数可视化配置

## 技术栈

- **前端**: Vue 3 + TypeScript + Vite + Tailwind CSS + Reka UI (shadcn-vue)
- **后端**: Rust + Tauri 2.x
- **构建工具**: Vite (前端), Cargo (Rust)
- **测试**: Vitest (前端单元测试)

## 项目结构

```
ffui/
├── src/                    # Vue 前端源代码
│   ├── components/        # Vue 组件
│   │   ├── ui/           # UI 组件库 (shadcn-vue)
│   │   ├── ParameterWizard.vue    # 参数向导组件
│   │   ├── QueueItem.vue          # 队列项组件
│   │   └── SmartScanWizard.vue    # 智能扫描向导
│   ├── lib/              # 工具库
│   ├── locales/          # 国际化语言文件
│   ├── assets/           # 静态资源
│   ├── main.ts          # 应用入口点
│   ├── App.vue          # 主应用组件
│   ├── types.ts         # TypeScript 类型定义
│   ├── constants.ts     # 常量定义
│   └── i18n.ts          # 国际化配置
├── src-tauri/           # Rust 后端 (Tauri)
│   ├── src/
│   │   ├── ffui_core/ # 转码核心模块
│   │   │   ├── mod.rs   # 模块导出
│   │   │   ├── domain.rs # 数据模型定义
│   │   │   ├── settings.rs # 应用设置
│   │   │   ├── tools.rs # 外部工具管理
│   │   │   ├── engine.rs # 转码引擎
│   │   │   └── monitor.rs # 系统监控
│   │   ├── lib.rs       # Tauri 命令定义
│   │   └── main.rs      # 程序入口点
│   ├── Cargo.toml       # Rust 依赖配置
│   └── tauri.conf.json  # Tauri 应用配置
├── dist/                # 构建输出目录
├── public/              # 静态资源文件
├── openspec/            # 项目规范和变更管理
├── package.json         # Node.js 项目配置
├── vite.config.ts       # Vite 构建配置
├── tailwind.config.cjs  # Tailwind CSS 配置
└── tsconfig.json       # TypeScript 配置
```

## 常用开发命令

### 前端开发
```bash
# 启动开发服务器
npm run dev

# 构建前端
npm run build

# 类型检查
npm run type-check
```

### Tauri 开发
```bash
# 启动 Tauri 开发模式
npm run tauri dev

# 构建 Tauri 应用
npm run tauri build
```

### Rust 后端开发
```bash
# 构建 Rust 后端
cd src-tauri && cargo build

# 运行测试
cd src-tauri && cargo test

# 检查代码
cd src-tauri && cargo check
```

### 完整开发流程
```bash
# 推荐方式：直接启动 Tauri（会自动启动前端开发服务器）
npm run tauri dev

# 或者分步启动：
# 1. 启动前端开发服务器
npm run dev
# 2. 在另一个终端启动 Tauri
npm run tauri dev
```

### 测试
```bash
# 运行前端单元测试
npm run test

# 运行 Rust 测试
cd src-tauri && cargo test

# 运行 Rust 代码检查（Clippy）
cd src-tauri && cargo clippy
```

## 架构说明

### 数据模型
- **Rust 端**: `src-tauri/src/ffui_core/domain.rs` 定义了核心数据结构
- **TypeScript 端**: `src/types.ts` 定义了前端类型
- 两端类型通过 `serde` 序列化/反序列化保持同步

### 转码模块架构
1. **Domain 层**: 定义 `EncoderType`, `VideoConfig`, `TranscodeJob` 等核心数据结构
2. **Engine 层**: 转码引擎实现，负责调用 FFmpeg 等外部工具
3. **Tools 层**: 外部工具管理，检测 FFmpeg 等工具的可用性
4. **Monitor 层**: 系统监控，获取 CPU/GPU 使用率
5. **Settings 层**: 应用设置管理

### 前端架构
1. **组件化设计**: 使用 Vue 3 Composition API 和 `<script setup>` 语法
2. **状态管理**: 使用 Vue 的响应式系统，无外部状态管理库
3. **UI 组件**: 基于 shadcn-vue 的 Reka UI 组件库
4. **国际化**: 使用 vue-i18n 支持多语言
5. **类型安全**: 完整的 TypeScript 类型定义

### Tauri 通信模式
1. **命令调用**: 前端通过 `invoke()` 调用 Rust 端的 `#[tauri::command]` 函数
   - 前端: `src/lib/backend.ts` 封装所有后端调用
   - 后端: `src-tauri/src/lib.rs` 定义所有 Tauri 命令
   - 数据通过 JSON 序列化/反序列化传递

2. **事件系统**: Rust 通过 `AppHandle::emit()` 向前端推送事件
   - `queue-update`: 队列状态变更通知
   - `smart-scan-progress`: 智能扫描进度更新

3. **文件协议**: 使用 `asset://` 协议访问本地文件（如视频预览）
   - 前端通过 `convertFileSrc()` 转换文件路径

## 开发注意事项

### 类型同步
- 修改 Rust 数据模型时，需要同步更新 TypeScript 类型定义
- 使用相同的字段命名约定（camelCase 前端，snake_case 后端）
- 通过 `serde` 的 `rename_all` 属性处理命名差异

### 错误处理
- Rust 端使用 `anyhow` 和 `thiserror` 进行错误处理
- 前端需要处理异步命令调用的错误
- 转码任务的状态通过 `JobStatus` 枚举管理

### 性能考虑
- 转码任务使用队列管理，支持并发控制（默认 2 个并发任务）
- 系统监控使用 `sysinfo` 和 `nvml-wrapper` 库
- 前端使用异步组件懒加载提升初始加载速度

### 国际化
- 语言文件位于 `src/locales/` 目录
- 使用 `vue-i18n` 进行文本翻译
- 默认语言为英语，支持中文切换

### Windows 平台特性
项目包含多个 Windows 特定功能实现：

1. **权限降级机制** (`src-tauri/src/lib.rs` 中的 `elevation_shim` 模块)
   - 检测应用是否以管理员权限运行
   - 自动重启为普通用户权限进程（继承 Explorer token）
   - 目的：确保窗口可以接收文件拖放操作（Windows 限制）

2. **任务栏进度** (`src-tauri/src/taskbar_progress.rs`)
   - 在 Windows 任务栏显示转码进度
   - 支持三种进度计算模式：按任务数量、按文件大小、按视频时长
   - 通过 `windows` crate 调用 Windows API

3. **后台进程管理**
   - FFmpeg 等外部工具通过 `CREATE_NO_WINDOW` 标志隐藏控制台窗口
   - 见 `configure_background_command()` 函数

## 配置说明

### Tauri 配置 (`src-tauri/tauri.conf.json`)
- 应用名称: `FFUI`
- 窗口尺寸: 1280x720
- 无边框窗口: true
- 背景色: `#020617` (深色主题)
- 开发服务器端口: 5188

### 前端配置
- **Vite**: 开发服务器配置在 `vite.config.ts`
- **Tailwind**: 配置在 `tailwind.config.cjs`
- **TypeScript**: 配置在 `tsconfig.json`

### 关键 Rust 依赖
- **核心**: `tauri` (2.x), `serde`, `anyhow`, `thiserror`
- **系统监控**: `sysinfo` (系统信息), `nvml-wrapper` (NVIDIA GPU 监控)
- **HTTP/下载**: `reqwest` (用于下载 FFmpeg 等工具)
- **Windows API**: `windows` crate (任务栏进度、权限管理等)
- **压缩**: `zip` (解压下载的工具包)

## 核心架构决策

### 转码引擎设计
- **单例引擎**: `TranscodingEngine` 使用 `Arc<Mutex<>>` 实现全局单例
- **队列管理**: 使用 `VecDeque` 管理任务队列，支持优先级调整
- **并发控制**: 通过 `Semaphore` 模式控制最大并发数（可配置）
- **进度追踪**: 解析 FFmpeg stderr 输出提取进度信息
- **状态同步**: 队列状态变更通过 Tauri 事件推送到前端

### 外部工具管理
- **自动下载**: 首次运行时自动检测并下载 FFmpeg、FFprobe、avifenc
- **工具状态**: `ExternalToolStatus` 枚举跟踪工具状态（可用/缺失/下载中）
- **路径管理**: 工具下载到应用数据目录，避免污染系统路径

### 智能扫描机制
- **批次管理**: 扫描结果按目录分组为批次
- **增量进度**: 每扫描 32 个文件发送一次进度更新
- **过滤规则**: 支持文件大小、分辨率、编码格式等多维度过滤

## 测试

### 前端测试
- 使用 Vitest 作为测试框架
- 测试文件位于 `src/lib/*.spec.ts`
- 主要测试内容：FFmpeg 命令生成、队列首选项逻辑

### Rust 测试
- 标准 Cargo 测试框架
- 运行 `cd src-tauri && cargo test`
- 库名称为 `ffui_lib`（避免与二进制名称冲突）

## 构建和部署

```bash
# 构建前端（输出到 dist/）
npm run build

# 构建 Tauri 应用（包含前端构建）
npm run tauri build

# 仅构建可执行文件（不打包安装程序）
npm run build:exe
```

### 生产构建说明
- Tauri 会自动处理应用打包（MSI、DMG、AppImage 等）
- 图标文件位于 `src-tauri/icons/` 目录
- 支持 Windows、macOS、Linux 跨平台
- 构建产物位于 `src-tauri/target/release/bundle/`

## 故障排除

### 常见问题
1. **Tauri 开发服务器无法启动**: 检查端口 5188 是否被占用
2. **Rust 编译错误**:
   - 确保 Rust 工具链版本 >= 1.70
   - Windows 平台需要 Visual Studio Build Tools
3. **前端热重载不工作**: 检查 `vite.config.ts` 中的 watch 配置
4. **转码工具未找到**: 应用会自动下载 FFmpeg，检查网络连接和应用数据目录权限
5. **GPU 监控不工作**: `nvml-wrapper` 仅支持 NVIDIA GPU，其他显卡会静默失败

### 调试技巧
- **前端**: 使用浏览器开发者工具（右键菜单打开）
- **Rust**: 使用 `println!` 或 `eprintln!` 输出到控制台
- **FFmpeg 命令**: 启用 `enableReport` 选项生成详细的 FFmpeg 日志
- **Tauri 开发工具**: 在 `tauri.conf.json` 中已启用 `devtools` 特性

## 代码规范

### Rust 代码
- 遵循 Rust 官方编码风格（`rustfmt`）
- 使用 `clippy` 进行代码检查
- 错误处理：公开 API 使用 `anyhow::Result`，内部错误使用 `thiserror`
- 命名：`snake_case` 用于函数和变量，`PascalCase` 用于类型
- `serde` 序列化时使用 `#[serde(rename_all = "camelCase")]` 保持与前端一致

### TypeScript/Vue 代码
- 使用 TypeScript 严格模式
- Vue 组件使用 `<script setup>` 语法糖
- CSS 使用 Tailwind 工具类，避免自定义 CSS
- 组件命名使用 PascalCase
- 工具函数位于 `src/lib/` 目录

### 提交前检查清单
- [ ] 运行 `npm run build` 确保前端构建通过
- [ ] 运行 `cd src-tauri && cargo check` 确保 Rust 编译通过
- [ ] 运行 `cd src-tauri && cargo clippy` 修复警告
- [ ] 运行 `npm run test` 确保测试通过
- [ ] 检查类型同步：修改 `domain.rs` 后同步更新 `types.ts`
