type UnlistenFn = () => void;

export class PhysicalPosition {
  x: number;
  y: number;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

export class PhysicalSize {
  width: number;
  height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
}

type Monitor = {
  position: PhysicalPosition;
  size: PhysicalSize;
  scaleFactor?: number;
};

export const currentMonitor = async (): Promise<Monitor | null> => {
  if (typeof window === "undefined") return null;
  const width = Math.max(1, Math.floor(window.screen?.width ?? window.innerWidth ?? 1920));
  const height = Math.max(1, Math.floor(window.screen?.height ?? window.innerHeight ?? 1080));
  const scaleFactor = Number.isFinite(window.devicePixelRatio) ? window.devicePixelRatio : 1;
  return {
    position: new PhysicalPosition(0, 0),
    size: new PhysicalSize(width, height),
    scaleFactor,
  };
};

class MockWindow {
  label = "main";
  #fullscreen = false;
  #alwaysOnTop = false;
  #maximized = false;
  #position = new PhysicalPosition(0, 0);
  #size = new PhysicalSize(1280, 720);
  #closeRequestedHandlers: Array<(event: { preventDefault: () => void }) => unknown> = [];

  async minimize(): Promise<void> {
    // no-op (docs screenshot mode)
  }

  async toggleMaximize(): Promise<void> {
    // no-op (docs screenshot mode)
  }

  async close(): Promise<void> {
    // no-op (docs screenshot mode)
  }

  async isFullscreen(): Promise<boolean> {
    return this.#fullscreen;
  }

  async setFullscreen(fullscreen: boolean): Promise<void> {
    this.#fullscreen = Boolean(fullscreen);
  }

  async isAlwaysOnTop(): Promise<boolean> {
    return this.#alwaysOnTop;
  }

  async setAlwaysOnTop(alwaysOnTop: boolean): Promise<void> {
    this.#alwaysOnTop = Boolean(alwaysOnTop);
  }

  async isMaximized(): Promise<boolean> {
    return this.#maximized;
  }

  async maximize(): Promise<void> {
    this.#maximized = true;
  }

  async unmaximize(): Promise<void> {
    this.#maximized = false;
  }

  async outerPosition(): Promise<PhysicalPosition> {
    return new PhysicalPosition(this.#position.x, this.#position.y);
  }

  async outerSize(): Promise<PhysicalSize> {
    return new PhysicalSize(this.#size.width, this.#size.height);
  }

  async setPosition(position: PhysicalPosition): Promise<void> {
    this.#position = new PhysicalPosition(position.x, position.y);
  }

  async setSize(size: PhysicalSize): Promise<void> {
    this.#size = new PhysicalSize(size.width, size.height);
  }

  async listen(_event: string, _handler: unknown): Promise<UnlistenFn> {
    // no-op (docs screenshot mode)
    return () => {};
  }

  async onCloseRequested(handler: (event: { preventDefault: () => void }) => unknown): Promise<UnlistenFn> {
    this.#closeRequestedHandlers.push(handler);
    return () => {
      const idx = this.#closeRequestedHandlers.indexOf(handler);
      if (idx >= 0) this.#closeRequestedHandlers.splice(idx, 1);
    };
  }
}

const sharedWindow = new MockWindow();

export const getCurrentWindow = (): MockWindow => sharedWindow;

// Some modules import the `Window` type/class from "@tauri-apps/api/window".
// Export a compatible runtime symbol so those imports don't crash when the
// docs screenshot Vite config aliases the module to this file.
export class Window extends MockWindow {}
