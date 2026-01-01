import fs from "node:fs";
import path from "node:path";

import { predictFromVqResults } from "@/lib/vqResults/predict";

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

const snapshot = readJson(path.resolve(process.cwd(), "public/vq/quality_snapshot.json"));
const smartPresets = readJson(path.resolve(process.cwd(), "src-tauri/assets/smart-presets.json"));

const presets = Array.isArray(smartPresets?.presets) ? smartPresets.presets : [];

const pickPreset = (id) => {
  const p = presets.find((v) => v && v.id === id) ?? null;
  if (!p) throw new Error(`preset not found: ${id}`);
  return p;
};

const gpuHint = String(process.env.FFUI_GPU_MODEL ?? "").trim() || null;

const ids = ["smart-hevc-fast", "smart-hevc-archive", "smart-hevc-nvenc-hq-constqp19"];

for (const id of ids) {
  const p = pickPreset(id);
  const predicted = predictFromVqResults(snapshot, p, { hardwareModelNameHint: gpuHint });
  const vmaf = predicted?.vmaf?.value ?? null;
  const datasetKey = predicted?.datasetKey ?? "—";
  const vmafText = typeof vmaf === "number" && Number.isFinite(vmaf) ? vmaf.toFixed(3) : "—";
  console.log(`${id}\t${p.video?.encoder ?? "?"}\t${datasetKey}\tvmaf=${vmafText}`);
}
