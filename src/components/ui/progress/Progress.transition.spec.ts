// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import ProgressComponent from "./Progress.vue";

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
  it("sets translateX and transitionDuration from props", () => {
    const wrapper = mount(ProgressComponent as any, {
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

  it("clamps transitionMs to a non-negative integer", () => {
    const wrapper = mount(ProgressComponent as any, {
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

  it("renders layered segments when provided", () => {
    const wrapper = mount(ProgressComponent as any, {
      props: {
        modelValue: 100,
        transitionMs: 120,
        variant: "default",
        segments: [
          { value: 100, variant: "default" },
          { value: 40, class: "bg-cyan-400", layerClass: "inset-0 h-full" },
        ],
      },
      global: {
        stubs: {
          ProgressRoot: ProgressRootStub,
          ProgressIndicator: ProgressIndicatorStub,
        },
      },
    });

    const segments = wrapper.findAll("[data-testid^='progress-segment-']");
    expect(segments).toHaveLength(2);
    expect(segments[0]?.attributes("style")).toContain("translateX(-0%)");
    expect(segments[1]?.attributes("style")).toContain("translateX(-60%)");
    expect(segments[1]?.classes()).toContain("bg-cyan-400");
    expect(segments[1]?.classes()).toContain("h-full");
  });
});
