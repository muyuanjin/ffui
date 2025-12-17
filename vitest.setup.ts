// Shared Vitest setup for both node and jsdom environments.
// Keep this file side-effect-only and lightweight.

import { afterEach, vi } from "vitest";

// Vue Test Utils mounts into a detached element by default. Some UI primitives
// (reka-ui Dialog/DropdownMenu) detect accessibility contracts by querying the
// live document (e.g. document.getElementById), which would otherwise emit
// runtime warnings during tests. Attach mounts to document.body by default so
// these checks see the rendered nodes.
const autoUnmountWrappers = new Set<any>();

vi.mock("@vue/test-utils", async () => {
  const actual = await vi.importActual<typeof import("@vue/test-utils")>("@vue/test-utils");

  const wrapMount =
    <T extends (...args: any[]) => any>(mountFn: T) =>
    ((component: any, options: any = {}) => {
      if (typeof document !== "undefined" && options?.attachTo == null) {
        const wrapper = mountFn(component, { ...options, attachTo: document.body });
        autoUnmountWrappers.add(wrapper);
        return wrapper;
      }
      const wrapper = mountFn(component, options);
      autoUnmountWrappers.add(wrapper);
      return wrapper;
    }) as unknown as T;

  return {
    ...actual,
    mount: wrapMount(actual.mount),
    shallowMount: wrapMount(actual.shallowMount),
  };
});

afterEach(() => {
  for (const wrapper of autoUnmountWrappers) {
    try {
      wrapper?.unmount?.();
    } catch {
      // ignore
    }
  }
  autoUnmountWrappers.clear();
});

// JSDOM does not implement Element.scrollIntoView. Some UI primitives (reka-ui)
// call it during keyboard navigation. Provide a no-op implementation to avoid
// unhandled rejections in tests.
if (typeof Element !== "undefined") {
  const proto = Element.prototype as any;
  if (typeof proto.scrollIntoView !== "function") {
    proto.scrollIntoView = () => {};
  }
}

// JSDOM focus handling can recurse with focus-trap implementations (reka-ui
// FocusScope). Guard against re-entrant focus/blur calls to avoid stack
// overflows while keeping the first focus attempt intact.
if (typeof HTMLElement !== "undefined") {
  const proto = HTMLElement.prototype as any;
  const originalFocus = proto.focus;
  const originalBlur = proto.blur;
  let focusDepth = 0;

  if (typeof originalFocus === "function") {
    proto.focus = function (...args: any[]) {
      if (focusDepth > 0) return;
      focusDepth += 1;
      try {
        return originalFocus.apply(this, args);
      } finally {
        focusDepth -= 1;
      }
    };
  }

  if (typeof originalBlur === "function") {
    proto.blur = function (...args: any[]) {
      if (focusDepth > 0) return;
      focusDepth += 1;
      try {
        return originalBlur.apply(this, args);
      } finally {
        focusDepth -= 1;
      }
    };
  }
}
