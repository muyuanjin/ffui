import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

const inspectMediaMock = vi.fn();
const buildPreviewUrlMock = vi.fn(() => "asset://preview");

vi.mock("@/lib/backend", () => ({
  hasTauri: () => true,
  inspectMedia: (path: string) => inspectMediaMock(path),
  buildPreviewUrl: (path: string) => buildPreviewUrlMock(path),
}));

vi.mock("@/lib/asyncJson", () => ({
  parseFfprobeJsonAsyncLite: async () => ({ format: { formatName: "mp3" }, streams: [], file: null }) as any,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

import { useMainAppMedia } from "./useMainAppMedia";

describe("useMainAppMedia media kind", () => {
  beforeEach(() => {
    inspectMediaMock.mockReset();
    inspectMediaMock.mockResolvedValue("{}");
  });

  it("marks an inspected audio file as audio, so the panel cannot label it Video", async () => {
    const media = useMainAppMedia({ t: (key: string) => key, activeTab: ref("media") as any });

    await media.inspectMediaForPath("C:/music/song.mp3");

    expect(media.inspectedMediaKind.value).toBe("audio");
    expect(media.inspectedIsImage.value).toBe(false);
  });

  it("keeps video and image kinds distinct", async () => {
    const media = useMainAppMedia({ t: (key: string) => key, activeTab: ref("media") as any });

    await media.inspectMediaForPath("C:/videos/clip.mkv");
    expect(media.inspectedMediaKind.value).toBe("video");

    await media.inspectMediaForPath("C:/images/cover.png");
    expect(media.inspectedMediaKind.value).toBe("image");
  });
});
