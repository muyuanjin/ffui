import { highlightFfmpegCommand } from "@/lib/ffmpegCommand";

export type BootFxMode = "startup" | "hold";

type StartBootTextStreamFxOptions = {
  root: HTMLElement;
  container: HTMLElement;
  mode: BootFxMode;
  commandPool: string[];
  clampCommand: (text: string) => string;
  maybeScheduleIdle: (task: () => void) => void;
  generateExtraCommands: () => Promise<string[]>;
  readyEvent: string;
  readyDatasetKey: string;
};

const sampleCommandPool = (pool: string[], count: number) => {
  if (pool.length === 0 || count <= 0) return [];

  const result: string[] = [];
  let last = "";

  while (result.length < count) {
    const remaining = count - result.length;
    const take = Math.min(pool.length, remaining);

    const indices = Array.from({ length: pool.length }, (_, i) => i);
    for (let i = 0; i < take; i += 1) {
      const j = i + Math.floor(Math.random() * (indices.length - i));
      [indices[i], indices[j]] = [indices[j]!, indices[i]!];
    }

    for (let i = 0; i < take; i += 1) {
      const cmd = pool[indices[i]!] ?? "";
      if (!cmd) continue;
      if (cmd === last && pool.length > 1) continue;
      result.push(cmd);
      last = cmd;
      if (result.length >= count) break;
    }

    if (pool.length === 1 && result.length < count) {
      result.push(pool[0]!);
      last = pool[0]!;
    }
  }

  return result.slice(0, count);
};

export const startBootTextStreamFx = (options: StartBootTextStreamFxOptions) => {
  const container = options.container;
  let disposed = false;
  let removeTimeout: number | null = null;
  let doneTimeout: number | null = null;
  let resizeRaf: number | null = null;

  let commandPool = options.commandPool.slice();

  const pickCommand = () => {
    return commandPool[Math.floor(Math.random() * commandPool.length)] ?? "";
  };

  const recentCounts = new Map<string, number>();
  const recentMax = 180;
  const recentQueue: string[] = [];

  const rememberCommand = (cmd: string) => {
    if (!cmd) return;
    recentQueue.push(cmd);
    recentCounts.set(cmd, (recentCounts.get(cmd) ?? 0) + 1);
    while (recentQueue.length > recentMax) {
      const removed = recentQueue.shift();
      if (!removed) continue;
      const next = (recentCounts.get(removed) ?? 1) - 1;
      if (next <= 0) recentCounts.delete(removed);
      else recentCounts.set(removed, next);
    }
  };

  const pickCommandAvoidingRecent = () => {
    if (commandPool.length === 0) return "";
    if (recentCounts.size === 0) return pickCommand();

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const cmd = pickCommand();
      if (!cmd) continue;
      if (!recentCounts.has(cmd)) return cmd;
    }

    return pickCommand();
  };

  const buildLineMotion = () => {
    const vw = typeof window !== "undefined" ? window.innerWidth : 800;
    const vh = typeof window !== "undefined" ? window.innerHeight : 600;

    const maxX = Math.max(220, vw * 0.46);
    const x0 = (Math.random() - 0.5) * maxX * 2;
    const x1 = x0 + (Math.random() - 0.5) * Math.max(120, maxX * 0.22);

    const downward = Math.random() < 0.25;
    const travel = Math.max(120, vh * (0.24 + Math.random() * 0.22));
    const y0 = downward ? -travel * 0.15 : travel * 0.15;
    const y1 = downward ? travel : -travel;

    const startScale = 0.94 + Math.random() * 0.08;
    const endScale = 1.03 + Math.random() * 0.08;

    const duration = 8.4 + Math.random() * 7.6;
    const delay = Math.random() * 2.0;

    const top = Math.max(0, Math.min(vh - 16, Math.random() * vh));

    return {
      top,
      duration,
      delay,
      x0,
      x1,
      y0,
      y1,
      startScale,
      endScale,
    };
  };

  const applyLine = (line: HTMLDivElement, cmd: string, withDelay: boolean) => {
    const motion = buildLineMotion();

    line.style.position = "absolute";
    line.style.left = "50%";
    line.style.top = `${motion.top.toFixed(1)}px`;

    line.style.setProperty("--x0", `${motion.x0.toFixed(1)}px`);
    line.style.setProperty("--x1", `${motion.x1.toFixed(1)}px`);
    line.style.setProperty("--y0", `${motion.y0.toFixed(1)}px`);
    line.style.setProperty("--y1", `${motion.y1.toFixed(1)}px`);
    line.style.setProperty("--s0", `${motion.startScale.toFixed(3)}`);
    line.style.setProperty("--s1", `${motion.endScale.toFixed(3)}`);

    line.innerHTML = highlightFfmpegCommand(cmd);
    line.style.animation = "none";
    void line.offsetHeight;
    const delay = withDelay ? motion.delay : 0;
    line.style.animation = `ffui-boot-flow ${motion.duration}s linear ${delay}s 1 both`;
    rememberCommand(cmd);
  };

  const createTextStream = (count = 56) => {
    container.innerHTML = "";
    container.classList.remove("ffui-boot-text-stream--blur-out");

    const batch = sampleCommandPool(commandPool, count);

    for (let index = 0; index < count; index += 1) {
      const line = document.createElement("div");
      line.className = "terminal-text";
      const command = batch[index] ?? pickCommandAvoidingRecent();
      applyLine(line, command, true);
      line.addEventListener("animationend", () => {
        if (disposed) return;
        applyLine(line, pickCommandAvoidingRecent(), false);
      });
      container.appendChild(line);
    }
  };

  const onBeforeUnload = () => {
    dispose();
  };

  const onReady = () => {
    if (options.mode !== "startup") return;
    if (disposed) return;

    container.classList.add("ffui-boot-text-stream--blur-out");
    doneTimeout = window.setTimeout(() => {
      if (disposed) return;
      options.root.classList.add("ffui-boot--done");
      removeTimeout = window.setTimeout(() => {
        try {
          options.root.remove();
        } catch {
          // Best-effort only.
        }
      }, 850);
    }, 600);
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener("beforeunload", onBeforeUnload);
    if (options.mode === "startup") window.removeEventListener(options.readyEvent, onReady);
    window.removeEventListener("resize", onResize);
    if (resizeRaf != null) window.cancelAnimationFrame(resizeRaf);
    if (removeTimeout != null) window.clearTimeout(removeTimeout);
    if (doneTimeout != null) window.clearTimeout(doneTimeout);
  };

  let lastWidth = typeof window !== "undefined" ? window.innerWidth : 0;
  let lastHeight = typeof window !== "undefined" ? window.innerHeight : 0;

  const onResize = () => {
    if (disposed) return;
    if (resizeRaf != null) return;
    resizeRaf = window.requestAnimationFrame(() => {
      resizeRaf = null;
      if (disposed) return;
      const nextWidth = window.innerWidth;
      const nextHeight = window.innerHeight;
      const changed = Math.abs(nextWidth - lastWidth) > 4 || Math.abs(nextHeight - lastHeight) > 4;
      lastWidth = nextWidth;
      lastHeight = nextHeight;
      if (changed) createTextStream();
    });
  };

  createTextStream();
  window.addEventListener("resize", onResize, { passive: true });

  if (options.mode === "startup") {
    if (document.documentElement.dataset[options.readyDatasetKey] === "1") {
      onReady();
    } else {
      window.addEventListener(options.readyEvent, onReady, { passive: true });
    }
  }

  options.maybeScheduleIdle(async () => {
    const extra = await options.generateExtraCommands();
    if (disposed || extra.length === 0) return;
    const set = new Set(commandPool);
    const beforeSize = set.size;
    for (const cmd of extra) set.add(options.clampCommand(cmd));
    commandPool = Array.from(set);
    if (set.size > beforeSize) createTextStream();
  });

  window.addEventListener("beforeunload", onBeforeUnload, { passive: true });
  return dispose;
};
