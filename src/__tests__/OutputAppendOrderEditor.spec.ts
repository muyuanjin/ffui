// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent, nextTick } from "vue";

let lastSortableOptions: any = null;

vi.mock("@vueuse/integrations/useSortable", () => ({
  useSortable: (_el: any, _list: any, options: any) => {
    lastSortableOptions = options;
  },
  moveArrayElement: (list: any, oldIndex: number, newIndex: number) => {
    if (typeof oldIndex !== "number" || typeof newIndex !== "number") return;
    const arr = Array.isArray(list?.value) ? list.value : Array.isArray(list) ? list : null;
    if (!arr) return;
    if (oldIndex < 0 || oldIndex >= arr.length) return;
    if (newIndex < 0 || newIndex >= arr.length) return;
    const next = [...arr];
    const [moved] = next.splice(oldIndex, 1);
    next.splice(newIndex, 0, moved);
    if (Array.isArray(list?.value)) list.value = next;
  },
}));

import OutputAppendOrderEditor from "@/components/output/OutputAppendOrderEditor.vue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import type { OutputFilenamePolicy } from "@/types";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
    "zh-CN": zhCN as any,
  },
});

const CheckboxStub = defineComponent({
  name: "Checkbox",
  props: {
    checked: { type: [Boolean, String], default: false },
  },
  emits: ["update:checked"],
  template: `<button type="button" v-bind="$attrs" @click="$emit('update:checked', !checked)"><slot /></button>`,
});

const InputStub = defineComponent({
  name: "Input",
  props: {
    modelValue: { type: [String, Number], default: "" },
  },
  emits: ["update:modelValue"],
  template: `<input v-bind="$attrs" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />`,
});

describe("OutputAppendOrderEditor", () => {
  it("enables timestamp via checkbox", async () => {
    const filename: OutputFilenamePolicy = {
      suffix: ".compressed",
      appendTimestamp: false,
      appendEncoderQuality: false,
      randomSuffixLen: undefined,
      appendOrder: ["suffix", "timestamp", "encoderQuality", "random"],
    };

    const wrapper = mount(OutputAppendOrderEditor, {
      props: {
        filename,
      },
      global: {
        plugins: [i18n],
        stubs: {
          Checkbox: CheckboxStub,
          Input: InputStub,
          Button: { template: `<button><slot /></button>` },
          Label: { template: `<label><slot /></label>` },
        },
      },
    });

    await wrapper.get("[data-testid='append-order-enable-timestamp']").trigger("click");

    const emitted = wrapper.emitted("update");
    expect(emitted).toBeTruthy();
    expect(emitted?.[0]?.[0]).toMatchObject({ appendTimestamp: true });
  });

  it("enables suffix and edits it inline", async () => {
    const filename: OutputFilenamePolicy = {
      suffix: undefined,
      appendTimestamp: false,
      appendEncoderQuality: false,
      randomSuffixLen: undefined,
      appendOrder: ["suffix", "timestamp", "encoderQuality", "random"],
    };

    const wrapper = mount(OutputAppendOrderEditor, {
      props: {
        filename,
      },
      global: {
        plugins: [i18n],
        stubs: {
          Checkbox: CheckboxStub,
          Input: InputStub,
          Button: { template: `<button><slot /></button>` },
          Label: { template: `<label><slot /></label>` },
        },
      },
    });

    await wrapper.get("[data-testid='append-order-enable-suffix']").trigger("click");
    let emitted = wrapper.emitted("update");
    expect(emitted).toBeTruthy();
    const firstPatch = emitted?.[0]?.[0] as any;
    expect(firstPatch).toMatchObject({ suffix: ".compressed" });
    await wrapper.setProps({ filename: { ...filename, ...firstPatch } });
    await nextTick();

    await wrapper.get("[data-testid='append-order-param-suffix']").setValue(".x");
    emitted = wrapper.emitted("update") ?? [];
    expect(emitted.length).toBeGreaterThan(0);
    const lastPatch = emitted[emitted.length - 1]?.[0] as any;
    expect(lastPatch).toMatchObject({ suffix: ".x" });
  });

  it("enables random and edits its length inline", async () => {
    const filename: OutputFilenamePolicy = {
      suffix: ".compressed",
      appendTimestamp: false,
      appendEncoderQuality: false,
      randomSuffixLen: undefined,
      appendOrder: ["suffix", "timestamp", "encoderQuality", "random"],
    };

    const wrapper = mount(OutputAppendOrderEditor, {
      props: {
        filename,
      },
      global: {
        plugins: [i18n],
        stubs: {
          Checkbox: CheckboxStub,
          Input: InputStub,
          Button: { template: `<button><slot /></button>` },
          Label: { template: `<label><slot /></label>` },
        },
      },
    });

    await wrapper.get("[data-testid='append-order-enable-random']").trigger("click");
    let emitted = wrapper.emitted("update");
    expect(emitted).toBeTruthy();
    const firstPatch = emitted?.[0]?.[0] as any;
    expect(firstPatch).toMatchObject({ randomSuffixLen: 6 });
    await wrapper.setProps({ filename: { ...filename, ...firstPatch } });
    await nextTick();

    await wrapper.get("[data-testid='append-order-param-random']").setValue("10");
    emitted = wrapper.emitted("update") ?? [];
    expect(emitted.length).toBeGreaterThan(0);
    const lastPatch = emitted[emitted.length - 1]?.[0] as any;
    expect(lastPatch).toMatchObject({ randomSuffixLen: 10 });
  });

  it("emits appendOrder after drag reorder", async () => {
    lastSortableOptions = null;
    const filename: OutputFilenamePolicy = {
      suffix: ".compressed",
      appendTimestamp: true,
      appendEncoderQuality: false,
      randomSuffixLen: 6,
      appendOrder: ["suffix", "timestamp", "encoderQuality", "random"],
    };

    const wrapper = mount(OutputAppendOrderEditor, {
      props: {
        filename,
      },
      global: {
        plugins: [i18n],
        stubs: {
          Checkbox: CheckboxStub,
          Input: InputStub,
          Button: { template: `<button><slot /></button>` },
          Label: { template: `<label><slot /></label>` },
        },
      },
    });

    expect(typeof lastSortableOptions?.onUpdate).toBe("function");
    lastSortableOptions.onUpdate({ oldIndex: 0, newIndex: 1 });

    const emitted = wrapper.emitted("update") ?? [];
    expect(emitted.length).toBeGreaterThan(0);
    const last = emitted[emitted.length - 1]?.[0] as any;
    expect(last.appendOrder?.slice(0, 2)).toEqual(["timestamp", "suffix"]);
  });
});
