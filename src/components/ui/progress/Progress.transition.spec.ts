// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";

const ProgressRootStub = defineComponent({
  name: "ProgressRoot",
  setup(_props, { attrs, slots }) {
    return () => h("div", { ...attrs, "data-testid": "progress-root-stub" }, slots.default?.());
  },
});

const ProgressIndicatorStub = defineComponent({
  name: "ProgressIndicator",
  setup(_props, { attrs }) {
    return () => h("div", { ...attrs, "data-testid": "progress-indicator-stub" });
  },
});

describe("Progress", () => {
  it("sets translateX and transitionDuration from props", async () => {
    const Component = (await import("./Progress.vue")).default;
    const wrapper = mount(Component as any, {
      props: { modelValue: 25, transitionMs: 0, variant: "default" },
      global: {
        stubs: {
          ProgressRoot: ProgressRootStub,
          ProgressIndicator: ProgressIndicatorStub,
        },
      },
    });

    const indicator = wrapper.get("[data-testid='progress-indicator-stub']");
    expect(indicator.attributes("style")).toContain("translateX(-75%)");
    expect(indicator.attributes("style")).toContain("transition-duration: 0ms");
  });

  it("clamps transitionMs to a non-negative integer", async () => {
    const Component = (await import("./Progress.vue")).default;
    const wrapper = mount(Component as any, {
      props: { modelValue: 50, transitionMs: -123, variant: "default" },
      global: {
        stubs: {
          ProgressRoot: ProgressRootStub,
          ProgressIndicator: ProgressIndicatorStub,
        },
      },
    });

    const indicator = wrapper.get("[data-testid='progress-indicator-stub']");
    expect(indicator.attributes("style")).toContain("transition-duration: 0ms");
  });
});
