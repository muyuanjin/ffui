// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, nextTick, ref } from "vue";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

vi.mock("lucide-vue-next", () => {
  return { X: { name: "X", template: "<svg />" } };
});

describe("DialogContent overlay close", () => {
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

    await nextTick();
    expect(wrapper.get('[data-testid="state"]').text()).toBe("open");
    await wrapper.get('[data-testid="dialog-overlay"]').trigger("pointerdown");
    await nextTick();
    expect(wrapper.get('[data-testid="state"]').text()).toBe("closed");
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
