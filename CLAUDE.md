# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

这是一个基于 Tauri 的桌面转码应用程序，结合了 Rust 后端和 Vue 3 前端。主要功能包括视频/图像转码、智能扫描、队列管理和系统监控。

## 技术栈

- **前端**: Vue 3 + TypeScript + Vite + Tailwind CSS + shadcn-vue (Reka UI)
- **后端**: Rust + Tauri 框架
- **构建工具**: Vite (前端), Cargo (Rust)
- **UI 组件**: Reka UI (基于 shadcn-vue)

## 项目结构

```
transcoding/
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
│   │   ├── transcoding/ # 转码核心模块
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
# 1. 启动前端开发服务器
npm run dev

# 2. 在另一个终端启动 Tauri
npm run tauri dev
```

## 架构说明

### 数据模型
- **Rust 端**: `src-tauri/src/transcoding/domain.rs` 定义了核心数据结构
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

### Tauri 通信
- 前端通过 `@tauri-apps/api` 调用 Rust 命令
- Rust 端通过 `#[tauri::command]` 宏暴露 API
- 数据通过 JSON 序列化在两端传递

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

## 配置说明

### Tauri 配置 (`src-tauri/tauri.conf.json`)
- 应用名称: `transcoding`
- 窗口尺寸: 1280x720
- 无边框窗口: true
- 背景色: `#020617` (深色主题)
- 开发服务器端口: 5183

### 前端配置
- **Vite**: 开发服务器配置在 `vite.config.ts`
- **Tailwind**: 配置在 `tailwind.config.cjs`
- **TypeScript**: 配置在 `tsconfig.json`

### Rust 依赖
- **核心**: `tauri`, `serde`, `anyhow`
- **工具**: `sysinfo` (系统信息), `nvml-wrapper` (NVIDIA GPU 监控)
- **错误处理**: `thiserror`

## 测试策略

### Rust 测试
```bash
# 运行所有测试
cd src-tauri && cargo test

# 运行特定模块测试
cd src-tauri && cargo test transcoding
```

### 前端测试
- 目前未配置前端测试框架
- 建议使用 Vitest 进行组件测试

## 构建和部署

### 开发构建
```bash
# 构建前端
npm run build

# 构建 Tauri 应用
npm run tauri build
```

### 生产构建
- Tauri 会自动处理应用打包
- 图标文件位于 `src-tauri/icons/` 目录
- 支持 Windows、macOS、Linux 平台

## 故障排除

### 常见问题
1. **Tauri 开发服务器无法启动**: 检查端口 5183 是否被占用
2. **Rust 编译错误**: 确保所有依赖项版本兼容
3. **前端热重载不工作**: 检查 Vite 配置和文件监视设置
4. **转码工具未找到**: 确保 FFmpeg 等外部工具已安装并添加到 PATH

### 调试技巧
- 使用 `console.log` 进行前端调试
- Rust 端使用 `println!` 或日志库
- Tauri 开发者工具可通过右键菜单打开

## 代码规范

### Rust 代码
- 遵循 Rust 官方编码风格
- 使用 `clippy` 进行代码检查
- 错误处理使用 `anyhow::Result`

### TypeScript/Vue 代码
- 使用 TypeScript 严格模式
- Vue 组件使用 `<script setup>` 语法
- CSS 使用 Tailwind 工具类
- 组件命名使用 PascalCase

### 提交规范
- 提交前运行 `cargo check` 和 `npm run build`
- 提交消息使用英文，描述更改内容
- 关联功能使用清晰的分支命名