import { describe, it, expect } from "vitest";
import { reactive, ref } from "vue";
import type { MappingConfig, VideoConfig } from "@/types";
import { validatePresetEditorState } from "./presetValidator";

describe("presetValidator (editor state)", () => {
  const makeBaseState = (overrides: Partial<any> = {}) => ({
    global: reactive({}) as any,
    input: reactive({}) as any,
    mapping: reactive({}) as any,
    video: reactive({
      encoder: "libx264",
      rateControl: "crf",
      qualityValue: 23,
      preset: "medium",
    }) as any,
    audio: reactive({ codec: "copy" }) as any,
    filters: reactive({}) as any,
    subtitles: reactive({}) as any,
    container: reactive({}) as any,
    hardware: reactive({}) as any,
    advancedEnabled: ref(false),
    ffmpegTemplate: ref(""),
    ...overrides,
  });

  it("reports and fixes maxrate < bitrate", () => {
    const video = reactive<VideoConfig>({
      encoder: "libx264",
      rateControl: "vbr",
      qualityValue: 23,
      preset: "medium",
      bitrateKbps: 3000,
      maxBitrateKbps: 2000,
      bufferSizeKbits: 4000,
    });

    const state = {
      global: reactive({}) as any,
      input: reactive({}) as any,
      mapping: reactive<MappingConfig>({}) as any,
      video,
      audio: reactive({}) as any,
      filters: reactive({}) as any,
      subtitles: reactive({}) as any,
      container: reactive({}) as any,
      hardware: reactive({}) as any,
      advancedEnabled: ref(false),
      ffmpegTemplate: ref(""),
    };

    const res = validatePresetEditorState(state as any);
    expect(res.byGroup.video.errors).toBeGreaterThan(0);

    const fix = res.byGroup.video.fixes.find((f) => f.id === "fix-video-maxrate-to-bitrate");
    expect(fix).toBeTruthy();
    fix!.apply(state as any);
    expect(video.maxBitrateKbps).toBe(3000);
  });

  it("reports and fixes invalid mapping indexes (< -1)", () => {
    const mapping = reactive<MappingConfig>({
      maps: [],
      mapMetadataFromInputFileIndex: -2,
      mapChaptersFromInputFileIndex: -3,
    } as any);

    const state = {
      global: reactive({}) as any,
      input: reactive({}) as any,
      mapping,
      video: reactive<VideoConfig>({
        encoder: "libx264",
        rateControl: "crf",
        qualityValue: 23,
        preset: "medium",
      }),
      audio: reactive({}) as any,
      filters: reactive({}) as any,
      subtitles: reactive({}) as any,
      container: reactive({}) as any,
      hardware: reactive({}) as any,
      advancedEnabled: ref(false),
      ffmpegTemplate: ref(""),
    };

    const res = validatePresetEditorState(state as any);
    expect(res.byGroup.mapping.errors).toBe(2);

    for (const fix of res.byGroup.mapping.fixes) fix.apply(state as any);
    expect(mapping.mapMetadataFromInputFileIndex).toBeUndefined();
    expect(mapping.mapChaptersFromInputFileIndex).toBeUndefined();
  });

  it("warns when advanced is enabled but template is empty and can fix it", () => {
    const advancedEnabled = ref(true);
    const ffmpegTemplate = ref("");

    const state = {
      global: reactive({}) as any,
      input: reactive({}) as any,
      mapping: reactive({}) as any,
      video: reactive({}) as any,
      audio: reactive({}) as any,
      filters: reactive({}) as any,
      subtitles: reactive({}) as any,
      container: reactive({}) as any,
      hardware: reactive({}) as any,
      advancedEnabled,
      ffmpegTemplate,
    };

    const res = validatePresetEditorState(state as any);
    expect(res.byGroup.command.warnings).toBe(1);

    const fix = res.byGroup.command.fixes[0];
    fix.apply(state as any);
    expect(advancedEnabled.value).toBe(false);
  });

  it("errors on invalid time expressions and can clear them", () => {
    const input = reactive({ seekPosition: "nope", duration: "1:2:3:4", inputTimeOffset: "??" }) as any;
    const state = makeBaseState({ input });

    const res = validatePresetEditorState(state as any);
    expect(res.byGroup.input.errors).toBeGreaterThan(0);

    const fixes = res.fixes.filter((f) => f.group === "input");
    expect(fixes.length).toBeGreaterThan(0);
    for (const f of fixes) f.apply(state as any);
    expect(input.seekPosition).toBeUndefined();
    expect(input.duration).toBeUndefined();
    expect(input.inputTimeOffset).toBeUndefined();
  });

  it("errors on non-integer stream_loop and can fix it", () => {
    const input = reactive({ streamLoop: 1.8 }) as any;
    const state = makeBaseState({ input });

    const res = validatePresetEditorState(state as any);
    expect(res.byGroup.input.errors).toBeGreaterThan(0);

    const fix = res.fixes.find((f) => f.labelKey === "presetEditor.validation.input.fixStreamLoopToInteger");
    expect(fix).toBeTruthy();
    fix!.apply(state as any);
    expect(input.streamLoop).toBe(1);
  });

  it("errors on invalid metadata/disposition syntax and can apply quick fixes", () => {
    const mapping = reactive({
      metadata: ["title"],
      dispositions: ["a:1"],
    }) as any;
    const state = makeBaseState({ mapping });

    const res = validatePresetEditorState(state as any);
    expect(res.byGroup.mapping.errors).toBeGreaterThan(0);

    const metaFix = res.fixes.find((f) => f.labelKey === "presetEditor.validation.mapping.fixMetadataAppendEquals");
    expect(metaFix).toBeTruthy();
    metaFix!.apply(state as any);
    expect(mapping.metadata[0]).toBe("title=");

    const dispFix = res.fixes.find((f) => f.labelKey === "presetEditor.validation.mapping.fixDispositionAppendDefault");
    expect(dispFix).toBeTruthy();
    dispFix!.apply(state as any);
    expect(mapping.dispositions[0]).toBe("a:1 default");
  });

  it("errors on invalid AAC params and can clear them", () => {
    const audio = reactive({ codec: "aac", bitrate: -1, sampleRateHz: 0, channels: -2 }) as any;
    const state = makeBaseState({ audio });

    const res = validatePresetEditorState(state as any);
    expect(res.byGroup.audio.errors).toBeGreaterThan(0);

    for (const f of res.fixes.filter((f) => f.group === "audio")) f.apply(state as any);
    expect(audio.bitrate).toBeUndefined();
    expect(audio.sampleRateHz).toBeUndefined();
    expect(audio.channels).toBeUndefined();
  });

  it("warns when filter_complex is set alongside vf/af generation", () => {
    const filters = reactive({ filterComplex: "graph", vfChain: "scale=-2:1080", afChain: "volume=1" }) as any;
    const audio = reactive({ codec: "aac", loudnessProfile: "none" }) as any;
    const state = makeBaseState({ filters, audio });

    const res = validatePresetEditorState(state as any);
    expect(res.byGroup.filters.warnings).toBeGreaterThan(0);
  });
});
