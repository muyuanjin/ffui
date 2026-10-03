// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, nextTick, ref } from "vue";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

describe("DialogContent overlay close", () => {
  const mountNestedSelect = async (overlayClosable = true, cancelOutside = false) => {
    const wrapper = mount(
      defineComponent({
        components: {
          Dialog,
          DialogContent,
          DialogTitle,
          DialogDescription,
          Select,
          SelectContent,
          SelectItem,
          SelectTrigger,
          SelectValue,
        },
        setup() {
          return { open: ref(true), value: ref("mp3"), overlayClosable, cancelOutside };
        },
        template: `
          <div>
            <div data-testid="state">{{ open ? "open" : "closed" }}</div>
            <div data-testid="value">{{ value }}</div>
            <Dialog v-model:open="open">
              <DialogContent :portal-disabled="true" :overlay-closable="overlayClosable"
                @pointer-down-outside="event => { if (cancelOutside) event.preventDefault() }">
                <DialogTitle>Output settings</DialogTitle>
                <DialogDescription>Choose a format</DialogDescription>
                <div data-testid="blank">Blank area</div>
                <Select v-model="value">
                  <SelectTrigger data-testid="format-trigger"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="mp3">MP3</SelectItem><SelectItem value="flac">FLAC</SelectItem></SelectContent>
                </Select>
              </DialogContent>
            </Dialog>
          </div>
        `,
      }),
      { attachTo: document.body },
    );
    await flushPromises();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    return wrapper;
  };

  const openSelect = async (wrapper: Awaited<ReturnType<typeof mountNestedSelect>>) => {
    await wrapper.get('[data-testid="format-trigger"]').trigger("keydown", { key: "ArrowDown" });
    await flushPromises();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(document.querySelector('[role="listbox"]')).not.toBeNull();
  };

  const pointerDown = async (element: Element, pointerType: string) => {
    const event = new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 });
    Object.defineProperty(event, "pointerType", { value: pointerType });
    element.dispatchEvent(event);
    if (pointerType === "touch") element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises();
  };

  it.each(["mouse", "touch"])("dismisses only the nested select on a %s overlay interaction", async (pointerType) => {
    const wrapper = await mountNestedSelect();
    await openSelect(wrapper);
    await pointerDown(wrapper.get('[data-testid="dialog-overlay"]').element, pointerType);
    await vi.waitFor(() => expect(document.querySelector('[role="listbox"]')).toBeNull());
    expect(wrapper.get('[data-testid="state"]').text()).toBe("open");
    expect(wrapper.get('[data-testid="value"]').text()).toBe("mp3");
    await pointerDown(wrapper.get('[data-testid="dialog-overlay"]').element, pointerType);
    await vi.waitFor(() => expect(wrapper.get('[data-testid="state"]').text()).toBe("closed"));
  });

  it("keeps the dialog and selection when dismissing a select from blank content", async () => {
    const wrapper = await mountNestedSelect();
    await openSelect(wrapper);
    await pointerDown(wrapper.get('[data-testid="blank"]').element, "mouse");
    await vi.waitFor(() => expect(document.querySelector('[role="listbox"]')).toBeNull());
    expect(wrapper.get('[data-testid="state"]').text()).toBe("open");
    expect(wrapper.get('[data-testid="value"]').text()).toBe("mp3");
  });

  it("closes the nested select before the dialog on successive Escape presses", async () => {
    const wrapper = await mountNestedSelect();
    await openSelect(wrapper);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await vi.waitFor(() => expect(document.querySelector('[role="listbox"]')).toBeNull());
    expect(wrapper.get('[data-testid="state"]').text()).toBe("open");
    expect(wrapper.get('[data-testid="value"]').text()).toBe("mp3");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await vi.waitFor(() => expect(wrapper.get('[data-testid="state"]').text()).toBe("closed"));
  });

  it.each(["policy", "consumer"])("keeps the dialog open when outside dismissal is cancelled by %s", async (owner) => {
    const wrapper = await mountNestedSelect(owner !== "policy", owner === "consumer");
    await pointerDown(wrapper.get('[data-testid="dialog-overlay"]').element, "mouse");
    expect(wrapper.get('[data-testid="state"]').text()).toBe("open");
    wrapper.get("button .sr-only").element.parentElement!.click();
    await vi.waitFor(() => expect(wrapper.get('[data-testid="state"]').text()).toBe("closed"));
  });

  it.each([
    { name: "right click", button: 2, ctrlKey: false },
    { name: "control-left click", button: 0, ctrlKey: true },
  ])("keeps the dialog open for a $name on the overlay", async ({ button, ctrlKey }) => {
    const wrapper = await mountNestedSelect();
    wrapper
      .get('[data-testid="dialog-overlay"]')
      .element.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button, ctrlKey }));
    await flushPromises();
    expect(wrapper.get('[data-testid="state"]').text()).toBe("open");
  });

  it("closes when the overlay is clicked", async () => {
    const wrapper = mount(
      defineComponent({
        components: { Dialog, DialogContent, DialogTitle, DialogDescription },
        setup() {
          const open = ref(true);
          return { open };
        },
        template: `
          <div>
            <div data-testid="state">{{ open ? "open" : "closed" }}</div>
            <Dialog v-model:open="open">
              <DialogContent :portal-disabled="true">
                <DialogTitle>Title</DialogTitle>
                <DialogDescription>Description</DialogDescription>
                <div data-testid="inside">inside</div>
              </DialogContent>
            </Dialog>
          </div>
        `,
      }),
      { attachTo: document.body },
    );

    await flushPromises();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(wrapper.get('[data-testid="state"]').text()).toBe("open");
    await wrapper.get('[data-testid="dialog-overlay"]').trigger("pointerdown");
    await nextTick();
    await vi.waitFor(() => expect(wrapper.get('[data-testid="state"]').text()).toBe("closed"));
  });

  it("does not close when interacting inside content", async () => {
    const wrapper = mount(
      defineComponent({
        components: { Dialog, DialogContent, DialogTitle, DialogDescription },
        setup() {
          const open = ref(true);
          return { open };
        },
        template: `
          <div>
            <div data-testid="state">{{ open ? "open" : "closed" }}</div>
            <Dialog v-model:open="open">
              <DialogContent :portal-disabled="true">
                <DialogTitle>Title</DialogTitle>
                <DialogDescription>Description</DialogDescription>
                <button type="button" data-testid="inside">inside</button>
              </DialogContent>
            </Dialog>
          </div>
        `,
      }),
      { attachTo: document.body },
    );

    await nextTick();
    await wrapper.get('[data-testid="inside"]').trigger("pointerdown");
    await nextTick();
    expect(wrapper.get('[data-testid="state"]').text()).toBe("open");
  });
});
