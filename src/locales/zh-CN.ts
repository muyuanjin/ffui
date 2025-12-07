import app from "./zh-CN/app";
import media from "./zh-CN/media";
import presetEditor from "./zh-CN/presetEditor";
import queue from "./zh-CN/queue";
import other from "./zh-CN/other";

const zhCN = {
  app,
  media,
  presetEditor,
  queue,
  // 扁平化 other 中的命名空间，并让 `monitor.*` 同时包含 app.monitor 中
  // 为性能监控 Pro 面板新增的标题与标签文案。
  ...other,
  monitor: {
    ...other.monitor,
    ...app.monitor,
  },
} as const;

export default zhCN;
