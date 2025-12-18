type UnlistenFn = () => void;

class MockWindow {
  label = "main";

  async minimize(): Promise<void> {
    // no-op (docs screenshot mode)
  }

  async toggleMaximize(): Promise<void> {
    // no-op (docs screenshot mode)
  }

  async close(): Promise<void> {
    // no-op (docs screenshot mode)
  }

  async listen(_event: string, _handler: unknown): Promise<UnlistenFn> {
    // no-op (docs screenshot mode)
    return () => {};
  }
}

const sharedWindow = new MockWindow();

export const getCurrentWindow = (): MockWindow => sharedWindow;

// Some modules import the `Window` type/class from "@tauri-apps/api/window".
// Export a compatible runtime symbol so those imports don't crash when the
// docs screenshot Vite config aliases the module to this file.
export class Window extends MockWindow {}
