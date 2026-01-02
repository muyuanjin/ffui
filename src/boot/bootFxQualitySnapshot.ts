type QualitySnapshotPayload = {
  datasets?: Array<{
    metric?: string;
    key?: string;
    points?: Array<{ x?: number; y?: number }>;
  }>;
};

const parsePresetKey = (key: string) => {
  const parts = key
    .trim()
    .replace(/^\s+|\s+$/g, "")
    .split("_")
    .filter(Boolean);

  const codecHint = parts[0] ?? "";
  const preset = parts[1] ?? "";
  const mode = parts[parts.length - 1] ?? "";

  const videoCodec =
    codecHint === "x264"
      ? "libx264"
      : codecHint === "x265"
        ? "libx265"
        : codecHint === "svtav1"
          ? "libsvtav1"
          : codecHint === "aomav1" || codecHint === "aom"
            ? "libaom-av1"
            : codecHint === "vp9"
              ? "libvpx-vp9"
              : codecHint === "vp8"
                ? "libvpx"
                : codecHint === "av1"
                  ? "libsvtav1"
                  : null;

  return { videoCodec, preset, mode };
};

export const generateCommandsFromQualitySnapshot = async () => {
  if (typeof window === "undefined") return [];

  try {
    const response = await fetch("/vq/quality_snapshot.json", { cache: "force-cache" });
    if (!response.ok) return [];

    const payload = (await response.json()) as QualitySnapshotPayload;
    const datasets = Array.isArray(payload.datasets) ? payload.datasets : [];
    if (datasets.length === 0) return [];

    const output: string[] = [];
    const sampleCount = Math.min(120, datasets.length);

    for (let index = 0; index < sampleCount; index += 1) {
      const dataset = datasets[(index * 97) % datasets.length];
      const key = dataset?.key ?? "";
      const metric = dataset?.metric ?? "";
      const points = Array.isArray(dataset?.points) ? dataset.points : [];
      const point = points.length > 0 ? points[(index * 29) % points.length] : null;

      const { videoCodec, preset, mode } = parsePresetKey(key);
      if (!videoCodec) continue;

      const bitrateKbps = point?.x ? Math.max(64, Math.round(point.x)) : null;
      const score = point?.y ? Math.max(0, Math.min(1, point.y)) : null;

      if (mode === "crf") {
        const crf = videoCodec === "libx264" ? 20 : videoCodec === "libx265" ? 24 : 30;
        output.push(
          `ffmpeg -i input.mp4 -c:v ${videoCodec}${preset ? ` -preset ${preset}` : ""} -crf ${crf} -c:a aac -b:a 192k output.mp4`,
        );
      } else if (mode === "abr" && bitrateKbps != null) {
        output.push(
          `ffmpeg -i input.mp4 -c:v ${videoCodec}${preset ? ` -preset ${preset}` : ""} -b:v ${bitrateKbps}k -maxrate ${Math.round(
            bitrateKbps * 1.2,
          )}k -bufsize ${Math.round(bitrateKbps * 2)}k -c:a aac -b:a 192k output.mp4`,
        );
      } else if (mode === "2pass" && bitrateKbps != null) {
        output.push(
          `ffmpeg -i input.mp4 -c:v ${videoCodec}${preset ? ` -preset ${preset}` : ""} -b:v ${bitrateKbps}k -pass 1 -an -f null /dev/null && ffmpeg -i input.mp4 -c:v ${videoCodec}${preset ? ` -preset ${preset}` : ""} -b:v ${bitrateKbps}k -pass 2 -c:a aac -b:a 192k output.mp4`,
        );
      } else {
        output.push(
          `ffmpeg -i input.mp4 -c:v ${videoCodec}${preset ? ` -preset ${preset}` : ""} -c:a aac -b:a 192k output.mp4`,
        );
      }

      if (metric && score != null) {
        output.push(
          `ffmpeg -hide_banner -i input.mp4 -c:v ${videoCodec}${preset ? ` -preset ${preset}` : ""} -f null -  # ${metric}≈${score.toFixed(4)}`,
        );
      }
    }

    return output;
  } catch {
    return [];
  }
};
