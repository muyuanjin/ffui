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
  ...other,
} as const;

export default zhCN;
