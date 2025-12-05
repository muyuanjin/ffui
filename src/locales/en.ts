import app from "./en/app";
import media from "./en/media";
import presetEditor from "./en/presetEditor";
import queue from "./en/queue";
import other from "./en/other";

const en = {
  app,
  media,
  presetEditor,
  queue,
  ...other,
} as const;

export default en;
