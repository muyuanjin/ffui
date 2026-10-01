// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

import Sidebar from "@/components/Sidebar.vue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";

const desktop = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/lib/backend", () => ({ hasTauri: () => desktop.enabled }));
vi.mock("@/components/dialogs/FfmpegCommandDialog.vue", () => ({
  __esModule: true,
  default: { props: ["open"], template: '<div data-testid="command-dialog-stub" />' },
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
    "zh-CN": zhCN as any,
  },
});

describe("Sidebar", () => {
  it("groups the command entry with file, folder and compression creation actions", async () => {
    i18n.global.locale.value = "en";
    const wrapper = mount(Sidebar, { props: { activeTab: "queue", jobs: [] }, global: { plugins: [i18n] } });
    const actions = wrapper.get('[data-testid="ffui-sidebar-add-actions"]');
    expect(actions.findAll("button").map((button) => button.attributes("data-testid"))).toEqual([
      "ffui-action-add-job-files",
      "ffui-action-add-job-folder",
      "ffui-action-batch-compress",
      "add-ffmpeg-command",
    ]);
    await actions.get('[data-testid="add-ffmpeg-command"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="command-dialog-stub"]').exists()).toBe(true);
    i18n.global.locale.value = "zh-CN";
    await flushPromises();
    expect(actions.get('[data-testid="add-ffmpeg-command"]').text()).toBe(zhCN.queue.command.add);
    wrapper.unmount();
    i18n.global.locale.value = "en";
  });

  it("does not offer a command in browser-only mode", () => {
    desktop.enabled = false;
    const wrapper = mount(Sidebar, { props: { activeTab: "queue", jobs: [] }, global: { plugins: [i18n] } });
    expect(wrapper.find('[data-testid="add-ffmpeg-command"]').exists()).toBe(false);
    wrapper.unmount();
    desktop.enabled = true;
  });
  it("shows current tab title and hint", () => {
    const wrapper = mount(Sidebar, {
      props: {
        activeTab: "queue",
        jobs: [],
      },
      global: {
        plugins: [i18n],
      },
    });

    expect(wrapper.get("[data-testid='ffui-sidebar-active-title']").text()).toBe("Transcode Tasks");
    expect(wrapper.get("[data-testid='ffui-sidebar-active-hint']").text()).toContain("Manage the transcoding queue");
  });

  it("renders an icon for each navigation item", () => {
    const wrapper = mount(Sidebar, {
      props: {
        activeTab: "queue",
        jobs: [],
      },
      global: {
        plugins: [i18n],
      },
    });

    expect(wrapper.find("[data-testid='ffui-tab-queue'] svg").exists()).toBe(true);
    expect(wrapper.find("[data-testid='ffui-tab-presets'] svg").exists()).toBe(true);
    expect(wrapper.find("[data-testid='ffui-tab-media'] svg").exists()).toBe(true);
    expect(wrapper.find("[data-testid='ffui-tab-monitor'] svg").exists()).toBe(true);
    expect(wrapper.find("[data-testid='ffui-tab-settings'] svg").exists()).toBe(true);
  });

  it("emits toggleScreenFx when clicking the logo", async () => {
    const wrapper = mount(Sidebar, {
      props: {
        activeTab: "queue",
        jobs: [],
        screenFxOpen: false,
      },
      global: {
        plugins: [i18n],
      },
    });

    await wrapper.get("[data-testid='ffui-sidebar-logo-link']").trigger("click");

    expect(wrapper.emitted("toggleScreenFx")).toBeTruthy();
  });
});
