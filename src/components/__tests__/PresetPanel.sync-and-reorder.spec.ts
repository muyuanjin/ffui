// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { defineComponent, ref, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import type { FFmpegPreset } from "@/types";
import PresetPanel from "@/components/panels/PresetPanel.vue";
import { i18n } from "@/__tests__/helpers/mainAppTauriDialog";

// Mock useSortable so we can trigger onEnd 手动模拟拖拽结束回调。
const useSortableMock = vi.fn();

vi.mock("@vueuse/integrations/useSortable", () => ({
  useSortable: (...args: any[]) => {
    // 记录调用参数，便于测试中手动调用 onEnd。
    useSortableMock(...args);
    return {
      start: () => {},
      stop: () => {},
      option: () => undefined,
    };
  },
}));

const makePreset = (id: string, quality: number): FFmpegPreset => ({
  id,
  name: `Preset ${id}`,
  description: `Desc ${id}`,
  video: {
    encoder: "libx264",
    rateControl: "crf",
    qualityValue: quality,
    preset: "medium",
  },
  audio: {
    codec: "aac",
    bitrate: 192,
  },
  filters: {},
  stats: {
    usageCount: 0,
    totalInputSizeMB: 0,
    totalOutputSizeMB: 0,
    totalTimeSeconds: 0,
  },
});

describe("PresetPanel 参数展示与拖拽排序", () => {
  it("Sortable 选中态类名为单一 token（避免 DOMTokenList 错误）", async () => {
    const presets = [makePreset("p1", 23), makePreset("p2", 21)];

    const wrapper = mount(PresetPanel, {
      props: {
        presets,
        edit: () => {},
        delete: () => {},
        reorder: () => {},
      },
      global: { plugins: [i18n] },
    });

    expect(useSortableMock.mock.calls.length).toBeGreaterThan(0);
    const lastCall = useSortableMock.mock.calls[useSortableMock.mock.calls.length - 1];
    const [, , options] = lastCall;

    // 断言：chosenClass 为 is-chosen，且不包含空格
    expect(options.chosenClass).toBe("is-chosen");
    expect(String(options.chosenClass).includes(" ")).toBe(false);

    wrapper.unmount();
  });
  it("当上游 presets 内容被替换时卡片展示会同步更新", async () => {
    const Parent = defineComponent({
      components: { PresetPanel },
      setup() {
        const presets = ref<FFmpegPreset[]>([makePreset("p1", 23)]);
        const edit = vi.fn();
        const remove = vi.fn();
        const reorder = vi.fn();
        return { presets, edit, remove, reorder };
      },
      template: `
        <PresetPanel
          :presets="presets"
          @edit="edit"
          @delete="remove"
          @reorder="reorder"
        />
      `,
    });

    const wrapper = mount(Parent, {
      global: { plugins: [i18n] },
    });

    // 初始卡片应展示 CRF 23
    expect(wrapper.text()).toContain("CRF 23");

    // 模拟在参数面板中保存预设：父级用 splice 替换数组中的元素（与 useMainAppPresets 逻辑一致）。
    const vm: any = wrapper.vm;
    vm.presets.splice(0, 1, makePreset("p1", 18));
    await nextTick();

    // 深度 watch 生效后，卡片应更新为 CRF 18
    expect(wrapper.text()).toContain("CRF 18");

    wrapper.unmount();
  });

  it("拖拽结束时会根据本地顺序发出正确的 reorder 事件", async () => {
    const presets = [makePreset("p1", 23), makePreset("p2", 21)];

    const wrapper = mount(PresetPanel, {
      props: {
        presets,
        edit: () => {},
        delete: () => {},
        reorder: () => {},
      },
      global: { plugins: [i18n] },
    });

    // 通过 useSortableMock 取到第三个参数（options），手动触发 onUpdate 模拟拖拽完成。
    expect(useSortableMock.mock.calls.length).toBeGreaterThan(0);
    const lastCall = useSortableMock.mock.calls[useSortableMock.mock.calls.length - 1];
    const [, , options] = lastCall;

    // 模拟 SortableJS 事件：将索引 0 的元素拖到索引 1 位置（p1 -> p2 后面）。
    options.onUpdate?.({
      oldIndex: 0,
      newIndex: 1,
    });

    // 使用带事件名的 API，并为类型断言出 payload 结构，避免 any/索引类型错误。
    const emitted = wrapper.emitted("reorder") as [string[]][];
    expect(emitted.length).toBeGreaterThan(0);
    // 第一次发出的 reorder 事件 payload 应为 ["p2", "p1"]
    expect(emitted[0][0]).toEqual(["p2", "p1"]);

    wrapper.unmount();
  });
});
