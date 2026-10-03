// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import fixture from "../../../src-tauri/tests/media-preview-contract.json";
import MediaPanel from "@/components/panels/MediaPanel.vue";

const inspectMediaMock = vi.fn();
const buildPreviewUrlMock = vi.fn((_path: string) => "asset://preview");

vi.mock("@/lib/backend", () => ({
  hasTauri: () => true,
  inspectMedia: (path: string) => inspectMediaMock(path),
  buildPreviewUrl: (path: string) => buildPreviewUrlMock(path),
}));

vi.mock("@/lib/asyncJson", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/asyncJson")>();
  const { parseFfprobeJson } = await import("@/lib/mediaInfo");
  return { ...original, parseFfprobeJsonAsyncLite: async (json: string) => parseFfprobeJson(json) };
});

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

import { useMainAppMedia } from "./useMainAppMedia";

describe("useMainAppMedia probe classification", () => {
  beforeEach(() => {
    inspectMediaMock.mockReset();
    buildPreviewUrlMock.mockClear();
  });

  it.each(fixture.classification)("routes $path to the $kind preview using the parsed streams", async (entry) => {
    inspectMediaMock.mockResolvedValue(JSON.stringify(entry.probe));
    const media = useMainAppMedia({ t: (key) => key, activeTab: ref("media") });

    await media.inspectMediaForPath(entry.path);

    expect(media.mediaInspectError.value).toBeNull();
    expect(media.inspectedMediaKind.value).toBe(entry.kind);
    expect(media.inspectedIsImage.value).toBe(entry.kind === "image");
    const wrapper = mount(MediaPanel, {
      props: {
        inspecting: media.isInspectingMedia.value,
        error: media.mediaInspectError.value,
        inspectedPath: media.inspectedMediaPath.value,
        previewUrl: media.inspectedPreviewUrl.value,
        isImage: media.inspectedIsImage.value,
        mediaKind: media.inspectedMediaKind.value,
        analysis: media.inspectedAnalysis.value,
        rawJson: null,
      },
      global: { plugins: [createI18n({ legacy: false, locale: "en", missingWarn: false, fallbackWarn: false })] },
    });
    const selector =
      entry.kind === "image" ? 'img[src="asset://preview"]' : `[data-testid="media-preview-${entry.kind}"]`;
    expect(wrapper.find(selector).exists()).toBe(true);
    if (entry.kind !== "video") expect(wrapper.find('[data-testid="media-preview-video"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("keeps inspectable subtitle metadata without inventing a playable preview", async () => {
    inspectMediaMock.mockResolvedValue(JSON.stringify({ streams: [{ codec_type: "subtitle" }] }));
    const media = useMainAppMedia({ t: (key) => key, activeTab: ref("media") });

    await media.inspectMediaForPath("C:/subtitle.mkv");

    expect(media.inspectedAnalysis.value?.streams[0].codecType).toBe("subtitle");
    expect(media.inspectedPreviewUrl.value).toBeNull();
    expect(buildPreviewUrlMock).not.toHaveBeenCalled();
    expect(media.isInspectingMedia.value).toBe(false);
  });
});
