/**
 * FFmpeg 命令生成与解析工具
 *
 * 提供 FFmpeg 命令的 tokenization、高亮渲染、模板规范化和命令构建功能
 */

// 导出类型
export type { CommandTokenKind, CommandToken } from "./tokenizer";

export type { TemplateParseResult } from "./normalization";

export type { FfmpegCommandPreviewInput } from "./builder";

// 导出工具函数
export { escapeHtml, tokenizeFfmpegCommand } from "./tokenizer";

export { assignCommandTokenGroups } from "./grouping";

export { highlightFfmpegCommand, highlightFfmpegCommandTokens } from "./rendering";
export { applyProgramOverridesToCommand } from "./rendering";

export { normalizeFfmpegTemplate } from "./normalization";

export { buildFfmpegCommandFromStructured, getFfmpegCommandPreview, getPresetCommandPreview } from "./builder";
