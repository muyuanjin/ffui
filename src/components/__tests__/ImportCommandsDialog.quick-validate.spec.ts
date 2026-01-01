// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import en from "@/locales/en";

const backendMock = vi.hoisted(() => ({
  validatePresetTemplate: vi.fn(),
}));

vi.mock("@/lib/backend", async () => {
  const actual = await vi.importActual<typeof import("@/lib/backend")>("@/lib/backend");
  return {
    ...actual,
    validatePresetTemplate: backendMock.validatePresetTemplate,
    hasTauri: () => true,
  };
});

import ImportCommandsDialog from "@/components/dialogs/ImportCommandsDialog.vue";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver = (globalThis as any).ResizeObserver || ResizeObserverMock;

const i18n = (createI18n as any)({
  legacy: false,
  locale: "en",
  messages: { en: en as any },
});
const t = (key: string, params?: any) => String(i18n.global.t(key, params));

const flushPromises = async () => {
  await new Promise((r) => setTimeout(r, 0));
};

describe("ImportCommandsDialog quick validate", () => {
  it("validates only selected custom-eligible lines and renders per-row status", async () => {
    backendMock.validatePresetTemplate.mockResolvedValue({ outcome: "ok" });

    const wrapper = mount(ImportCommandsDialog, {
      props: { open: true },
      global: {
        plugins: [i18n],
        stubs: {
          Dialog: { template: "<div><slot /></div>" },
          DialogContent: { template: "<div><slot /></div>" },
          DialogHeader: { template: "<div><slot /></div>" },
          DialogTitle: { template: "<div><slot /></div>" },
          DialogDescription: { template: "<div><slot /></div>" },
          DialogFooter: { template: "<div><slot /></div>" },
        },
      },
    });

    const input = wrapper.get("[data-testid='import-commands-textarea']");
    await input.setValue(
      ["ffmpeg -hide_banner -i INPUT -c:v libx264 -c:a copy OUTPUT", "ffmpeg -hide_banner -i INPUT -c:v libx264"].join(
        "\n",
      ),
    );
    await flushPromises();

    const rows = wrapper.findAll("[data-testid='import-commands-row']");
    expect(rows.length).toBe(2);

    await wrapper.get("[data-testid='import-commands-validate-selected']").trigger("click");

    expect(backendMock.validatePresetTemplate).toHaveBeenCalledTimes(1);

    await flushPromises();
    expect(wrapper.text()).toContain(t("presetEditor.advanced.quickValidate.ok"));
  });
});
