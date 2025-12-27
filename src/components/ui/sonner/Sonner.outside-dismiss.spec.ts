// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";

const dismiss = vi.fn();

vi.mock("vue-sonner", async () => {
  return {
    toast: {
      dismiss,
    },
    Toaster: defineComponent({
      name: "MockToaster",
      setup(_props, { attrs }) {
        return () => h("div", { ...attrs, "data-sonner-toaster": "" });
      },
    }),
  };
});

describe("Sonner", () => {
  it("does not dismiss when clicking outside the toaster", async () => {
    const Component = (await import("./Sonner.vue")).default;
    mount(Component as any, { props: { position: "bottom-right" } });

    const toastEl = document.createElement("div");
    toastEl.setAttribute("data-sonner-toast", "");
    document.body.appendChild(toastEl);

    const outside = document.createElement("div");
    outside.setAttribute("data-testid", "outside");
    document.body.appendChild(outside);

    outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(dismiss).toHaveBeenCalledTimes(0);

    toastEl.remove();
    outside.remove();
  });

  it("does not dismiss when clicking inside the toaster", async () => {
    dismiss.mockClear();
    const Component = (await import("./Sonner.vue")).default;
    const wrapper = mount(Component as any, { props: { position: "bottom-right" } });

    const toastEl = document.createElement("div");
    toastEl.setAttribute("data-sonner-toast", "");
    document.body.appendChild(toastEl);

    wrapper.element.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(dismiss).toHaveBeenCalledTimes(0);

    toastEl.remove();
  });
});
