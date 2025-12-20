// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import zhCN from "@/locales/zh-CN";
import SettingsPanel from "./SettingsPanel.vue";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

const i18n = createI18n({
  legacy: false,
  locale: "zh-CN",
  messages: { "zh-CN": zhCN },
});

const baseProps = {
  appSettings: {
    tools: { autoDownload: true, autoUpdate: true },
    previewCapturePercent: 25,
    taskbarProgressMode: "byEstimatedTime",
    taskbarProgressScope: "allJobs",
  } as any,
  toolStatuses: [] as any[],
  isSavingSettings: false,
  settingsSaveError: null as string | null,
  fetchToolCandidates: vi.fn(async () => []),
};

describe("SettingsPanel card layout", () => {
  it("renders cards in the expected left/right order", () => {
    const wrapper = mount(SettingsPanel, { props: baseProps as any, global: { plugins: [i18n] } });

    const left = wrapper.get("[data-testid='settings-left-column']");
    const right = wrapper.get("[data-testid='settings-right-column']");

    const leftIds = left.findAll("[data-testid^='settings-card-']").map((node) => node.attributes("data-testid"));
    const rightIds = right.findAll("[data-testid^='settings-card-']").map((node) => node.attributes("data-testid"));

    expect(leftIds).toEqual([
      "settings-card-tool-management",
      "settings-card-auto-download",
      "settings-card-network-proxy",
      "settings-card-performance",
      "settings-card-queue-recovery",
      "settings-card-data-storage",
    ]);

    expect(rightIds).toEqual([
      "settings-card-app-update",
      "settings-card-appearance",
      "settings-card-preview",
      "settings-card-progress-display",
      "settings-card-refresh-frequency",
      "settings-card-community",
      "settings-card-devtools",
    ]);
  });

  it("uses the configured 4-character Chinese card titles", () => {
    const wrapper = mount(SettingsPanel, { props: baseProps as any, global: { plugins: [i18n] } });

    const expectCardTitle = (testId: string, expectedTitle: string) => {
      const card = wrapper.get(`[data-testid='${testId}']`);
      expect(card.get("h3").text()).toBe(expectedTitle);
    };

    expectCardTitle("settings-card-tool-management", "工具管理");
    expectCardTitle("settings-card-auto-download", "自动下载");
    expectCardTitle("settings-card-network-proxy", "网络代理");
    expectCardTitle("settings-card-performance", "性能并发");
    expectCardTitle("settings-card-refresh-frequency", "刷新频率");
    expectCardTitle("settings-card-data-storage", "数据存储");
    expectCardTitle("settings-card-queue-recovery", "队列恢复");
    expectCardTitle("settings-card-preview", "预览设置");
    expectCardTitle("settings-card-appearance", "界面外观");
    expectCardTitle("settings-card-progress-display", "进度显示");
    expectCardTitle("settings-card-app-update", "应用更新");
    expectCardTitle("settings-card-community", "社区支持");
    expectCardTitle("settings-card-devtools", "开发工具");
  });

  it("avoids shrink-based overflow in adaptive layouts", () => {
    const wrapper = mount(SettingsPanel, { props: baseProps as any, global: { plugins: [i18n] } });

    const grid = wrapper.get("[data-testid='settings-panel-grid']");
    expect(grid.classes()).toContain("grow");
    expect(grid.classes()).toContain("shrink-0");
    expect(grid.classes()).not.toContain("min-h-0");
    expect(grid.classes()).not.toContain("flex-1");

    const autoDownloadGroup = wrapper.get("[data-testid='settings-auto-download-mode-group']");
    expect(autoDownloadGroup.classes()).not.toContain("min-h-0");

    const queueRecoveryCard = wrapper.get("[data-testid='settings-card-queue-recovery']");
    const queuePersistenceGroup = queueRecoveryCard.get("[data-testid='settings-queue-persistence-mode-group']");
    expect(queuePersistenceGroup.classes()).not.toContain("min-h-0");
    expect(queuePersistenceGroup.classes()).not.toContain("content-between");
  });
});
