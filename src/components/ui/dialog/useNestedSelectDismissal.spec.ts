// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import { provideNestedSelectDismissal, registerNestedSelect } from "./useNestedSelectDismissal";

function mountBoundary() {
  const open = ref(false);
  const visible = ref(true);
  const isOwned = vi.fn<(event: Event) => boolean>();
  const Child = defineComponent({
    setup() {
      registerNestedSelect(() => open.value);
      return () => h("span");
    },
  });
  const Parent = defineComponent({
    setup() {
      isOwned.mockImplementation(provideNestedSelectDismissal());
      return () => h("div", visible.value ? [h(Child)] : []);
    },
  });
  return { wrapper: mount(Parent), open, visible, isOwned };
}

describe("dialog nested Select dismissal ownership", () => {
  it.each(["mouse", "touch"])(
    "retains the original %s event after the child closes and unmounts",
    async (pointerType) => {
      const boundary = mountBoundary();
      await nextTick();
      boundary.open.value = true;
      const event = new PointerEvent("pointerdown", { bubbles: true, pointerType });
      document.body.dispatchEvent(event);
      boundary.open.value = false;
      boundary.visible.value = false;
      await nextTick();
      expect(boundary.isOwned(event)).toBe(true);
      const nextEvent = new PointerEvent("pointerdown", { bubbles: true, pointerType });
      document.body.dispatchEvent(nextEvent);
      expect(boundary.isOwned(nextEvent)).toBe(false);
    },
  );

  it("owns Escape but not other keys and lets the next Escape close the dialog", async () => {
    const boundary = mountBoundary();
    await nextTick();
    boundary.open.value = true;
    const other = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
    document.body.dispatchEvent(other);
    expect(boundary.isOwned(other)).toBe(false);
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    document.body.dispatchEvent(escape);
    boundary.open.value = false;
    expect(boundary.isOwned(escape)).toBe(true);
    const nextEscape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    document.body.dispatchEvent(nextEscape);
    expect(boundary.isOwned(nextEscape)).toBe(false);
  });

  it("isolates independent dialogs and unregisters unmounted children", async () => {
    const first = mountBoundary();
    const second = mountBoundary();
    await nextTick();
    first.open.value = true;
    const event = new PointerEvent("pointerdown", { bubbles: true });
    document.body.dispatchEvent(event);
    expect(first.isOwned(event)).toBe(true);
    expect(second.isOwned(event)).toBe(false);
    first.visible.value = false;
    await nextTick();
    const afterUnmount = new PointerEvent("pointerdown", { bubbles: true });
    document.body.dispatchEvent(afterUnmount);
    expect(first.isOwned(afterUnmount)).toBe(false);
    first.wrapper.unmount();
    const disposed = new PointerEvent("pointerdown", { bubbles: true });
    document.body.dispatchEvent(disposed);
    expect(first.isOwned(disposed)).toBe(false);
  });
});
