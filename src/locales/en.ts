import app from "./en/app";
import media from "./en/media";
import presetEditor from "./en/presetEditor";
import queue from "./en/queue";
import vqResults from "./en/vqResults";
import other from "./en/other";

const en = {
  app,
  media,
  presetEditor,
  queue,
  vqResults,
  // Flatten shared namespaces from `other`, but ensure `monitor.*` also
  // exposes the enhanced performance monitor labels from `app.monitor`.
  ...other,
  monitor: {
    ...other.monitor,
    ...app.monitor,
  },
} as const;

export default en;
