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

function mountPanel(mediaKind: "video" | "audio" | "image", previewUrl: string | null = null) {
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
      previewUrl,
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

  it("plays an audio preview instead of routing it through the video fallback", () => {
    const wrapper = mountPanel("audio", "asset://song.mp3");

    expect(wrapper.find('[data-testid="media-preview-audio"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="media-preview-video"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("nativePlaybackFailed");
  });

  it("keeps a visible outlet when the audio preview cannot be decoded natively", async () => {
    const wrapper = mountPanel("audio", "asset://song.wma");

    await wrapper.find('[data-testid="media-preview-audio"]').trigger("error");

    const fallback = wrapper.find('[data-testid="media-preview-audio-fallback"]');
    expect(fallback.exists()).toBe(true);
    expect(fallback.text()).toContain("previewFallback.nativePlaybackFailed");
    expect(fallback.find("button").exists()).toBe(true);
  });
});
