import commandsRaw1 from "../../docs/ffmpeg_commands.txt?raw";
import commandsRaw2 from "../../docs/ffmpeg_commands2.txt?raw";
import { generateCommandsFromQualitySnapshot } from "@/boot/bootFxQualitySnapshot";
import { startBootTextStreamFx } from "@/boot/bootFxTextStream";

const BOOT_READY_EVENT = "ffui:app-ready";
const BOOT_READY_DATASET_KEY = "ffuiAppReady";

type BootElements = {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  textStream?: HTMLElement;
  percentText?: HTMLElement;
  progressFill?: HTMLElement;
};

export type BootFxIds = {
  rootId: string;
  canvasId: string;
  textStreamId?: string;
  percentTextId?: string;
  progressFillId?: string;
};

type StreamLine = {
  x: number;
  y: number;
  speed: number;
  text: string;
};

const normalizeCommandLines = (raw: string) => {
  return raw
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#"))
    .filter((line) => !line.startsWith("//"));
};

const clampCommandForCanvas = (text: string) => {
  const maxChars = 360;
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 3)}...`;
};

const buildInitialCommandPool = () => {
  const set = new Set<string>();
  for (const line of normalizeCommandLines(commandsRaw1)) set.add(clampCommandForCanvas(line));
  for (const line of normalizeCommandLines(commandsRaw2)) set.add(clampCommandForCanvas(line));
  return Array.from(set);
};

const maybeScheduleIdle = (task: () => void) => {
  if (typeof window === "undefined") return;

  const requestIdle = (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;

  if (typeof requestIdle === "function") {
    requestIdle(() => task());
    return;
  }

  window.setTimeout(task, 0);
};

const DEFAULT_BOOT_IDS: BootFxIds = {
  rootId: "ffui-boot",
  canvasId: "ffui-boot-stream",
  textStreamId: "ffui-boot-text-stream",
};

const resolveBootElements = (ids: BootFxIds): BootElements | null => {
  if (typeof document === "undefined") return null;

  const root = document.getElementById(ids.rootId);
  const canvas = document.getElementById(ids.canvasId);
  if (!root || !(canvas instanceof HTMLCanvasElement)) return null;

  const textStream = ids.textStreamId ? (document.getElementById(ids.textStreamId) ?? undefined) : undefined;
  const percentText = ids.percentTextId ? (document.getElementById(ids.percentTextId) ?? undefined) : undefined;
  const progressFill = ids.progressFillId ? (document.getElementById(ids.progressFillId) ?? undefined) : undefined;

  return { root, canvas, textStream, percentText, progressFill };
};

export const signalAppReady = () => {
  if (typeof document !== "undefined") {
    document.documentElement.dataset[BOOT_READY_DATASET_KEY] = "1";
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(BOOT_READY_EVENT));
  }
};

type BootFxMode = "startup" | "hold";

const startBootFxInternal = (ids: BootFxIds, mode: BootFxMode) => {
  const elements = resolveBootElements(ids);
  if (!elements) return null;

  if (typeof window !== "undefined" && elements.textStream) {
    let commandPool = buildInitialCommandPool();
    if (commandPool.length === 0) {
      commandPool = ["ffmpeg -i input.mp4 -c:v libx264 -crf 20 -c:a aac output.mp4"];
    }

    return startBootTextStreamFx({
      root: elements.root,
      container: elements.textStream,
      mode,
      commandPool,
      clampCommand: clampCommandForCanvas,
      maybeScheduleIdle,
      generateExtraCommands: generateCommandsFromQualitySnapshot,
      readyEvent: BOOT_READY_EVENT,
      readyDatasetKey: BOOT_READY_DATASET_KEY,
    });
  }

  const reducedMotion =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let commandPool = buildInitialCommandPool();
  if (commandPool.length === 0) {
    commandPool = ["ffmpeg -i input.mp4 -c:v libx264 -crf 20 -c:a aac output.mp4"];
  }

  const ctx = elements.canvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  const lines: StreamLine[] = [];
  const maxLines = 72;

  let rafId: number | null = null;
  let timeoutId: number | null = null;
  let lastNow = 0;
  let progress = 0;
  let ready = false;
  let completed = false;

  const pickCommand = () => {
    return commandPool[Math.floor(Math.random() * commandPool.length)] ?? "";
  };

  const resizeCanvas = () => {
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const rect = elements.canvas.getBoundingClientRect();
    const nextWidth = Math.max(1, Math.floor(rect.width * dpr));
    const nextHeight = Math.max(1, Math.floor(rect.height * dpr));

    if (elements.canvas.width === nextWidth && elements.canvas.height === nextHeight) return;
    elements.canvas.width = nextWidth;
    elements.canvas.height = nextHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const initLines = () => {
    lines.length = 0;

    const rect = elements.canvas.getBoundingClientRect();
    const viewWidth = rect.width;
    const viewHeight = rect.height;

    const baseX = viewWidth * 0.06;
    const jitterX = viewWidth * 0.18;

    for (let index = 0; index < maxLines; index += 1) {
      lines.push({
        x: baseX + Math.random() * jitterX,
        y: Math.random() * viewHeight,
        speed: 18 + Math.random() * 46,
        text: pickCommand(),
      });
    }
  };

  const updateProgressUi = () => {
    const clamped = Math.max(0, Math.min(1, progress));
    const percent = Math.floor(clamped * 100);
    if (elements.percentText) elements.percentText.textContent = `${percent}%`;
    if (elements.progressFill) elements.progressFill.style.width = `${clamped * 100}%`;
  };

  const dispose = () => {
    if (completed) return;
    completed = true;

    if (mode === "startup") {
      window.removeEventListener(BOOT_READY_EVENT, onReady);
    }
    window.removeEventListener("beforeunload", onBeforeUnload);
    if (rafId != null) window.cancelAnimationFrame(rafId);
    if (timeoutId != null) window.clearTimeout(timeoutId);
  };

  const onBeforeUnload = () => {
    dispose();
  };

  const complete = () => {
    if (completed) return;
    completed = true;

    if (mode === "startup") {
      window.removeEventListener(BOOT_READY_EVENT, onReady);
    }
    window.removeEventListener("beforeunload", onBeforeUnload);
    if (rafId != null) window.cancelAnimationFrame(rafId);
    if (timeoutId != null) window.clearTimeout(timeoutId);

    elements.root.classList.add("ffui-boot--done");
    window.setTimeout(() => {
      try {
        elements.root.remove();
      } catch {
        // Best-effort only.
      }
    }, 850);
  };

  const tick = (now: number) => {
    if (completed) return;

    if (!lastNow) lastNow = now;
    const deltaMs = Math.max(0, Math.min(64, now - lastNow));
    lastNow = now;
    const dt = deltaMs / 1000;

    if (mode === "startup") {
      const target = ready ? 1 : 0.9;
      const easing = ready ? 5.5 : progress < 0.65 ? 1.7 : progress < 0.85 ? 0.75 : 0.35;
      progress = progress + (target - progress) * (1 - Math.exp(-easing * dt));
    } else {
      progress = 0.62 + Math.sin(now / 1000) * 0.06;
    }
    updateProgressUi();

    resizeCanvas();
    const rect = elements.canvas.getBoundingClientRect();
    const viewWidth = rect.width;
    const viewHeight = rect.height;

    ctx.clearRect(0, 0, viewWidth, viewHeight);
    ctx.font =
      "11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
    ctx.textBaseline = "top";

    const motionScale = reducedMotion ? 0.25 : 1;

    for (const line of lines) {
      line.y -= line.speed * dt * motionScale;
      if (line.y < -28) {
        line.y = viewHeight + Math.random() * 56;
        line.x = viewWidth * 0.06 + Math.random() * viewWidth * 0.18;
        line.speed = 18 + Math.random() * 46;
        line.text = pickCommand();
      }

      const t = viewHeight > 0 ? Math.max(0, Math.min(1, line.y / viewHeight)) : 0;
      const fade = 1 - Math.abs(0.5 - t) * 2;
      const alpha = 0.12 + Math.max(0, fade) * 0.55;

      ctx.fillStyle = `rgba(74, 222, 128, ${alpha})`;
      ctx.fillText(line.text, line.x, line.y);
    }

    if (mode === "startup") {
      if (ready && progress >= 0.995) {
        complete();
        return;
      }
    }

    if (reducedMotion) {
      timeoutId = window.setTimeout(() => tick(performance.now()), 80);
      return;
    }

    rafId = window.requestAnimationFrame(tick);
  };

  const onReady = () => {
    ready = true;
  };

  if (mode === "startup") {
    if (document.documentElement.dataset[BOOT_READY_DATASET_KEY] === "1") {
      ready = true;
    }

    window.addEventListener(BOOT_READY_EVENT, onReady, { passive: true });
  }

  resizeCanvas();
  initLines();
  updateProgressUi();

  if (reducedMotion) {
    timeoutId = window.setTimeout(() => tick(performance.now()), 0);
  } else {
    rafId = window.requestAnimationFrame((now) => {
      lastNow = now;
      rafId = window.requestAnimationFrame(tick);
    });
  }

  maybeScheduleIdle(async () => {
    const extra = await generateCommandsFromQualitySnapshot();
    if (extra.length === 0) return;
    const set = new Set(commandPool);
    for (const cmd of extra) set.add(clampCommandForCanvas(cmd));
    commandPool = Array.from(set);
  });

  window.addEventListener("beforeunload", onBeforeUnload, { passive: true });

  return dispose;
};

export const startBootFx = () => startBootFxInternal(DEFAULT_BOOT_IDS, "startup");

export const startHoldBootFx = (ids: BootFxIds) => {
  return startBootFxInternal(ids, "hold");
};
