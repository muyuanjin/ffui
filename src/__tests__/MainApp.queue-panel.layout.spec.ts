// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { i18n, useBackendMock, defaultAppSettings } from "./helpers/mainAppTauriDialog";
import MainApp from "@/MainApp.vue";

describe("MainApp queue panel layout", () => {
  it("keeps the queue panel in a flex column with non-zero height constraints", async () => {
    useBackendMock({
      get_queue_state: () => ({ jobs: [] }),
      get_queue_state_lite: () => ({ jobs: [] }),
      get_app_settings: () => defaultAppSettings(),
    });

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;
    vm.activeTab = "queue";
    await nextTick();

    const queuePanel = wrapper.get("[data-testid='queue-panel']");
    const paddingWrapper = queuePanel.element.parentElement;
    expect(paddingWrapper?.className).toContain("flex");
    expect(paddingWrapper?.className).toContain("flex-col");
    expect(paddingWrapper?.className).toContain("flex-1");
    expect(paddingWrapper?.className).toContain("min-h-0");

    const tabWrapper = paddingWrapper?.parentElement;
    expect(tabWrapper?.className).toContain("flex");
    expect(tabWrapper?.className).toContain("flex-col");
    expect(tabWrapper?.className).toContain("flex-1");
    expect(tabWrapper?.className).toContain("min-h-0");

    wrapper.unmount();
  });
});
