// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import MediaPanel from "@/components/panels/MediaPanel.vue";

const analysis = {
  format: { formatName: "mp3" },
  summary: { durationSeconds: 12 },
  streams: [],
  file: { path: "C:/music/song.mp3" },
} as any;

function mountPanel(mediaKind: "video" | "audio" | "image") {
  const i18n = createI18n({
    legacy: false,
    locale: "en",
    messages: {
      en: { media: { typeVideo: "Video", typeImage: "Image", typeAudio: "Audio" } },
    },
  });
  return mount(MediaPanel, {
    props: {
      inspecting: false,
      error: null,
      inspectedPath: "C:/music/song.mp3",
      previewUrl: null,
      isImage: mediaKind === "image",
      mediaKind,
      analysis,
      rawJson: null,
    },
    global: { plugins: [i18n] },
  });
}

describe("MediaPanel media kind", () => {
  it("labels an audio file as Audio, so a panel that reads only isImage is caught", () => {
    const text = mountPanel("audio").text();
    expect(text).toContain("Audio");
    expect(text).not.toContain("Video");
  });
});
