import type { TranscodeJob } from "@/types";
import { buildJobPreviewUrl } from "@/lib/backend";
import { highlightFfmpegCommand } from "@/lib/ffmpegCommand";

type LiveRenderFlowOptions = {
  textWorld: HTMLElement;
  imageWorld: HTMLElement;
  getJobs: () => TranscodeJob[];
};

type LiveRow = {
  textEl: HTMLDivElement;
  imageEl: HTMLDivElement;
  x: number;
  y: number;
  speed: number;
  imageOffsetPx: number;
  textFadeProbePx: number;
  fadeStartPx: number;
  fadeWidthPx: number;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const smoothstep = (t: number) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

const clampNumber = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const clampText = (text: string, maxChars: number) => {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
};

const getEffectivePreviewPath = (job: TranscodeJob): string | null => {
  if (typeof job.previewPath === "string" && job.previewPath.length > 0) return job.previewPath;
  if (job.type !== "image") return null;
  if (typeof job.outputPath === "string" && job.outputPath.length > 0) return job.outputPath;
  if (typeof job.inputPath === "string" && job.inputPath.length > 0) return job.inputPath;
  return null;
};

const pickJob = (jobs: TranscodeJob[]) => {
  if (jobs.length === 0) return null;
  const idx = Math.floor(Math.random() * jobs.length);
  return jobs[idx] ?? null;
};

const estimateTextWidthPx = (text: string) => {
  const avgCharPx = 7.1;
  return clampNumber(text.length * avgCharPx, 260, 980);
};

const parseRunSpeedX = (job: TranscodeJob): number | null => {
  const logs = job.runs?.[job.runs.length - 1]?.logs;
  if (!logs || logs.length === 0) return null;

  for (let i = logs.length - 1; i >= 0 && i >= logs.length - 40; i -= 1) {
    const lineLike = logs[i];
    const text = typeof lineLike === "string" ? lineLike : lineLike?.text;
    if (!text) continue;
    const match = text.match(/\bspeed\s*=\s*([0-9]+(?:\.[0-9]+)?)x\b/i);
    if (!match) continue;
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value <= 0) continue;
    return value;
  }

  return null;
};

const inferSpeedScale = (job: TranscodeJob, command: string) => {
  let scale = 1;

  const speedX = parseRunSpeedX(job);
  if (speedX != null) {
    const normalized = Math.log2(speedX + 0.1);
    scale *= clampNumber(1 + normalized * 0.06, 0.88, 1.16);
  }

  if (/\b(filter_complex|-vf)\b/i.test(command)) scale *= 0.94;
  if (/\b(libx265|hevc)\b/i.test(command) && !/\b(nvenc|qsv|vaapi|videotoolbox)\b/i.test(command)) scale *= 0.96;
  if (/\b(nvenc|qsv|vaapi|videotoolbox)\b/i.test(command)) scale *= 1.05;
  if (/\b-preset\s+(ultrafast|superfast|veryfast|faster)\b/i.test(command)) scale *= 1.06;
  if (/\b-preset\s+(slower|veryslow)\b/i.test(command)) scale *= 0.94;

  const jitter = 0.92 + Math.random() * 0.18;
  scale *= jitter;
  return clampNumber(scale, 0.82, 1.22);
};

export const startLiveRenderFlow = (options: LiveRenderFlowOptions) => {
  const prefersReducedMotion =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const rows: LiveRow[] = [];
  const maxRows = prefersReducedMotion ? 12 : 18;
  const baseSpawnMinMs = prefersReducedMotion ? 260 : 140;
  const baseSpawnJitterMs = prefersReducedMotion ? 260 : 180;
  const minSpeed = prefersReducedMotion ? 70 : 55;
  const maxSpeed = prefersReducedMotion ? 150 : 130;
  const verticalBuckets = 14;

  let rafId: number | null = null;
  let spawnTimer: number | null = null;
  let resizeTimer: number | null = null;
  let lastNow = 0;

  const spawnRow = () => {
    const jobs = options.getJobs().filter((job) => job.status === "processing");
    const job = pickJob(jobs);
    if (!job) return;
    if (rows.length >= maxRows) return;

    const trackHeight = Math.max(48, window.innerHeight / verticalBuckets);
    const trackIndex = Math.floor(Math.random() * verticalBuckets);
    const topPos = trackIndex * trackHeight + Math.random() * 12;

    const speed = minSpeed + Math.random() * (maxSpeed - minSpeed);
    const viewportWidth = Math.max(1, window.innerWidth || 1);
    const startX = -Math.min(180, Math.max(24, viewportWidth * 0.12));

    const rawCommand =
      job.runs?.[job.runs.length - 1]?.command ||
      job.ffmpegCommand ||
      `ffmpeg -i "${job.filename}" -c:v libx264 -crf 23 -c:a copy output.mp4`;
    const cmd = clampText(rawCommand, 240);

    const textRow = document.createElement("div");
    textRow.className = "ffui-screenfx-row";
    textRow.style.top = `${topPos}px`;
    textRow.style.opacity = "1";

    const code = document.createElement("div");
    code.className = "ffui-screenfx-code";
    code.innerHTML = highlightFfmpegCommand(cmd);
    textRow.appendChild(code);

    const imageRow = document.createElement("div");
    imageRow.className = "ffui-screenfx-row";
    imageRow.style.top = `${topPos}px`;
    imageRow.style.opacity = "0";

    const image = document.createElement("div");
    image.className = "ffui-screenfx-image";

    const effectivePreviewPath = getEffectivePreviewPath(job);
    const previewUrl = buildJobPreviewUrl(effectivePreviewPath, job.previewRevision);

    const img = document.createElement("img");
    img.src = previewUrl ?? "/ffui.svg";
    img.alt = job.filename;
    img.decoding = "async";
    img.loading = "eager";
    image.appendChild(img);
    imageRow.appendChild(image);

    options.textWorld.appendChild(textRow);
    options.imageWorld.appendChild(imageRow);

    const measuredWidth = code.getBoundingClientRect().width;
    const textWidth = measuredWidth > 1 ? measuredWidth : estimateTextWidthPx(cmd);
    const imageOffsetBase = clampNumber(textWidth * (0.4 + Math.random() * 0.35), 220, 560);
    const imageOffsetPx = clampNumber(imageOffsetBase + (Math.random() - 0.5) * 140, 200, 640);
    image.style.transform = `translateX(${imageOffsetPx.toFixed(1)}px)`;

    const fadeCenter = clampNumber(
      viewportWidth * 0.5 + (Math.random() - 0.5) * viewportWidth * 0.12,
      viewportWidth * 0.28,
      viewportWidth * 0.72,
    );
    const fadeWidthPx = clampNumber(viewportWidth * 0.18 + (Math.random() - 0.5) * 120, 160, 420);
    const fadeStartPx = fadeCenter - fadeWidthPx * 0.5;
    const textFadeProbePx = clampNumber(textWidth * (0.55 + Math.random() * 0.2), 160, 760);

    const speedScale = inferSpeedScale(job, rawCommand);

    rows.push({
      textEl: textRow,
      imageEl: imageRow,
      x: startX,
      y: topPos,
      speed: speed * speedScale,
      imageOffsetPx,
      textFadeProbePx,
      fadeStartPx,
      fadeWidthPx,
    });
  };

  const tick = (now: number) => {
    if (!lastNow) lastNow = now;
    const deltaMs = Math.max(0, Math.min(64, now - lastNow));
    lastNow = now;
    const dt = deltaMs / 1000;

    const endX = window.innerWidth + 200;
    const imageCenterOffsetPx = 62;

    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const row = rows[i];
      row.x += row.speed * dt;
      const transform = `translate3d(${row.x}px, 0, 0)`;
      row.textEl.style.transform = transform;
      row.imageEl.style.transform = transform;

      const imageProbeX = row.x + row.imageOffsetPx + imageCenterOffsetPx;
      const textProbeX = row.x + row.textFadeProbePx;
      const fadeWidth = Math.max(1, row.fadeWidthPx);
      const imageMix = smoothstep((imageProbeX - row.fadeStartPx) / fadeWidth);
      const textMix = smoothstep((textProbeX - row.fadeStartPx) / fadeWidth);
      row.textEl.style.opacity = String(1 - textMix);
      row.imageEl.style.opacity = String(imageMix);

      if (row.x > endX) {
        row.textEl.remove();
        row.imageEl.remove();
        rows.splice(i, 1);
      }
    }

    rafId = window.requestAnimationFrame(tick);
  };

  for (let i = 0; i < 12; i += 1) {
    window.setTimeout(spawnRow, i * (prefersReducedMotion ? 140 : 120) + Math.random() * 80);
  }

  const onResize = () => {
    if (resizeTimer != null) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      resizeTimer = null;
      for (let i = 0; i < 10; i += 1) spawnRow();
    }, 120);
  };

  window.addEventListener("resize", onResize, { passive: true });

  const scheduleNextSpawn = () => {
    spawnTimer = window.setTimeout(
      () => {
        spawnRow();
        scheduleNextSpawn();
      },
      baseSpawnMinMs + Math.random() * baseSpawnJitterMs,
    );
  };

  scheduleNextSpawn();
  rafId = window.requestAnimationFrame(tick);

  return () => {
    window.removeEventListener("resize", onResize);
    if (resizeTimer != null) window.clearTimeout(resizeTimer);
    if (spawnTimer != null) window.clearTimeout(spawnTimer);
    if (rafId != null) window.cancelAnimationFrame(rafId);
    for (const row of rows) {
      row.textEl.remove();
      row.imageEl.remove();
    }
    rows.length = 0;
  };
};
