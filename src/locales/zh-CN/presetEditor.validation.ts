const validation = {
  groupSummary: "错误 {errors} · 警告 {warnings}",
  fixGroup: "一键修正",
  details: "展开详情",
  issuesTitle: "问题",
  fixesTitle: "可修正项",
  locate: "定位",
  applyFix: "修正",
  errorLabel: "错误",
  warningLabel: "警告",
  command: {
    emptyTemplateButEnabled: "已启用自定义命令，但模板为空。",
    fixDisableAdvanced: "关闭自定义命令",
    invalidTemplatePlaceholders:
      "自定义命令模板必须且只能包含 1 个 INPUT 和 1 个 OUTPUT 占位符（当前 INPUT ×{inputCount}，OUTPUT ×{outputCount}）。",
  },
  mapping: {
    invalidMapIndex: "输入索引无效：{value}（必须 ≥ -1）。",
    fixMapIndexToAuto: "改为自动",
    invalidMetadataPair: "元数据条目无效：{value}（应为 key=value）。",
    fixMetadataAppendEquals: "补上 '=' 作为 key=",
    invalidDispositionMissingValue: "disposition 规则无效：{value}（缺少值）。",
    fixDispositionAppendDefault: "补上 'default'",
  },
  input: {
    invalidTimeExpression: "时间表达式无效：{value}。",
    fixClearTimeExpression: "清空该值",
    invalidStreamLoop: "循环次数无效：{value}（必须为整数）。",
    fixStreamLoopToInteger: "转为整数",
  },
  video: {
    maxrateBelowBitrate: "maxrate（{maxrate}k）必须 ≥ bitrate（{bitrate}k）。",
    fixMaxrateToBitrate: "将 maxrate 设为 bitrate",
    bufsizeOutOfRange: "bufsize（{bufsize}k）不在建议范围：{min}k–{max}k。",
    fixBufsizeTo2xMaxrate: "将 bufsize 设为 2× maxrate",
    qualityOutOfRange: "质量值 {value} 超出编码器范围（{min}–{max}）。",
    integerFieldRequired: "{field} 必须为整数（当前 {value}）。",
  },
  audio: {
    invalidBitrate: "音频码率无效：{value}（必须 > 0）。",
    fixClearBitrate: "清空音频码率",
    invalidSampleRate: "采样率无效：{value}（必须 > 0）。",
    fixClearSampleRate: "清空采样率",
    invalidChannels: "声道数无效：{value}（必须 > 0）。",
    fixClearChannels: "清空声道数",
  },
  filters: {
    filterComplexWithVfAf: "已设置 filter_complex，同时仍可能生成 -vf/-af，可能与预期不一致。",
    invalidFps: "FPS 必须为正数表达式：整数、小数、30000/1001 这类分数，或 film/ntsc_film/pal/ntsc（当前 {value}）。",
  },
} as const;

export default validation;
