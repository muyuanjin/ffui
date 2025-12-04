import { describe, it, expect } from "vitest";
import {
  highlightFfmpegCommand,
  normalizeFfmpegTemplate,
  buildFfmpegCommandFromStructured,
  type FfmpegCommandPreviewInput,
} from "./ffmpegCommand";
import type {
  AudioCodecType,
  AudioConfig,
  EncoderType,
  FilterConfig,
  RateControlMode,
  SubtitlesConfig,
  VideoConfig,
} from "@/types";

const splitArgs = (command: string): string[] =>
  command.split(/\s+/).filter((part) => part.length > 0);

describe("ffmpegCommand utilities", () => {
  it("renders highlighted command without changing the plain text content", () => {
    const cmd =
      'ffmpeg -hide_banner -nostdin -i "C:/videos/input.mp4" -c:v libx264 -crf 23 "C:/videos/output.mp4" -y';

    const html = highlightFfmpegCommand(cmd);
    // Should contain spans for options / paths.
    expect(html).toContain("text-blue-400");
    expect(html).toContain("text-amber-400");

    // Strip tags and decode the basic HTML entities we use in highlighting.
    const stripTags = html.replace(/<[^>]+>/g, "");
    const decode = (value: string) =>
      value
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&");
    const text = decode(stripTags);
    expect(text).toBe(cmd);
  });

  it("normalizes a simple one-input-one-output command into INPUT/OUTPUT template", () => {
    const input =
      'ffmpeg -hide_banner -nostdin -i "C:/videos/input.mp4" -c:v libx264 -crf 23 "C:/videos/output.mp4" -y';

    const result = normalizeFfmpegTemplate(input);
    expect(result.inputReplaced).toBe(true);
    expect(result.outputReplaced).toBe(true);
    expect(result.template).toContain('"INPUT"');
    expect(result.template).toContain('"OUTPUT"');
    expect(result.template.startsWith("ffmpeg ")).toBe(true);
  });

  it("falls back to last non-option token as OUTPUT when no explicit placeholder is present", () => {
    const input = "ffmpeg -i INPUT.mp4 -c:v libx264 -crf 23 OUTPUT.mkv";
    const result = normalizeFfmpegTemplate(input);
    expect(result.inputReplaced).toBe(true);
    expect(result.outputReplaced).toBe(true);
    expect(result.template).toContain("INPUT");
    expect(result.template).toContain("OUTPUT");
  });

  it("handles commands that already use INPUT/OUTPUT placeholders", () => {
    const input =
      'ffmpeg -hide_banner -nostdin -i INPUT -c:v libx264 -crf 23 OUTPUT -y';
    const result = normalizeFfmpegTemplate(input);
    expect(result.template).toBe(input);
    expect(result.inputReplaced).toBe(true);
    expect(result.outputReplaced).toBe(true);
  });
});

describe("buildFfmpegCommandFromStructured - parameter combinations", () => {
  const makeBaseVideo = (overrides: Partial<VideoConfig> = {}): VideoConfig => ({
    encoder: "libx264",
    rateControl: "crf",
    qualityValue: 23,
    preset: "medium",
    ...overrides,
  });

  const makeBaseAudio = (codec: AudioCodecType = "copy"): AudioConfig => ({
    codec,
  });

  const makeBaseFilters = (overrides: Partial<FilterConfig> = {}): FilterConfig => ({
    ...overrides,
  });

  const makeInput = (overrides: Partial<FfmpegCommandPreviewInput>): FfmpegCommandPreviewInput => ({
    video: makeBaseVideo(),
    audio: makeBaseAudio(),
    filters: makeBaseFilters(),
    ...overrides,
  });

  it("never mixes CRF/CQ flags with bitrate/two-pass flags across encoder/rateControl matrix", () => {
    const encoders: EncoderType[] = ["libx264", "hevc_nvenc", "libsvtav1"];
    const modes: RateControlMode[] = ["crf", "cq", "cbr", "vbr"];

    for (const encoder of encoders) {
      for (const mode of modes) {
        const cmd = buildFfmpegCommandFromStructured(
          makeInput({
            video: makeBaseVideo({
              encoder,
              rateControl: mode,
              qualityValue: 25,
              bitrateKbps: 3000,
              maxBitrateKbps: 4000,
              bufferSizeKbits: 6000,
              pass: 2,
            }),
          }),
        );
        const args = splitArgs(cmd);
        const hasCrf = args.includes("-crf");
        const hasCq = args.includes("-cq");
        const hasBitrate = args.includes("-b:v");
        const hasMaxrate = args.includes("-maxrate");
        const hasBufsize = args.includes("-bufsize");
        const hasPass = args.includes("-pass");

        if (mode === "crf") {
          expect(hasCrf).toBe(true);
          expect(hasCq).toBe(false);
          expect(hasBitrate || hasMaxrate || hasBufsize || hasPass).toBe(false);
        } else if (mode === "cq") {
          expect(hasCq).toBe(true);
          expect(hasCrf).toBe(false);
          expect(hasBitrate || hasMaxrate || hasBufsize || hasPass).toBe(false);
        } else {
          // CBR/VBR/2-pass: bitrate-related flags allowed, CRF/CQ not allowed.
          expect(hasCrf).toBe(false);
          expect(hasCq).toBe(false);
          expect(hasBitrate || hasMaxrate || hasBufsize || hasPass).toBe(true);
        }
      }
    }
  });

  it("emits only copy encoder flag for video when encoder=copy even if quality fields are set", () => {
    const cmd = buildFfmpegCommandFromStructured(
      makeInput({
        video: makeBaseVideo({
          encoder: "copy",
          rateControl: "cbr",
          qualityValue: 18,
          bitrateKbps: 3000,
          maxBitrateKbps: 4000,
          bufferSizeKbits: 6000,
          pass: 2,
        }),
      }),
    );
    const args = splitArgs(cmd);

    const cIndex = args.indexOf("-c:v");
    expect(cIndex).toBeGreaterThan(-1);
    expect(args[cIndex + 1]).toBe("copy");

    expect(args).not.toContain("-crf");
    expect(args).not.toContain("-cq");
    expect(args).not.toContain("-b:v");
    expect(args).not.toContain("-maxrate");
    expect(args).not.toContain("-bufsize");
    expect(args).not.toContain("-pass");
  });

  it("respects audio codec copy vs aac and never mixes re-encode flags into copy mode", () => {
    const sharedAudioFields: Pick<
      AudioConfig,
      "bitrate" | "sampleRateHz" | "channels" | "channelLayout"
    > = {
      bitrate: 192,
      sampleRateHz: 44100,
      channels: 2,
      channelLayout: "stereo",
    };

    const copyCmd = buildFfmpegCommandFromStructured(
      makeInput({
        audio: {
          codec: "copy",
          ...sharedAudioFields,
        },
      }),
    );
    const copyArgs = splitArgs(copyCmd);
    const cIndex = copyArgs.indexOf("-c:a");
    expect(cIndex).toBeGreaterThan(-1);
    expect(copyArgs[cIndex + 1]).toBe("copy");
    expect(copyArgs).not.toContain("-b:a");
    expect(copyArgs).not.toContain("-ar");
    expect(copyArgs).not.toContain("-ac");
    expect(copyArgs).not.toContain("-channel_layout");

    const aacCmd = buildFfmpegCommandFromStructured(
      makeInput({
        audio: {
          codec: "aac",
          ...sharedAudioFields,
        },
      }),
    );
    const aacArgs = splitArgs(aacCmd);
    const aIndex = aacArgs.indexOf("-c:a");
    expect(aIndex).toBeGreaterThan(-1);
    expect(aacArgs[aIndex + 1]).toBe("aac");
    expect(aacArgs).toContain("-b:a");
    expect(aacArgs).toContain("192k");
    expect(aacArgs).toContain("-ar");
    expect(aacArgs).toContain("44100");
    expect(aacArgs).toContain("-ac");
    expect(aacArgs).toContain("2");
    expect(aacArgs).toContain("-channel_layout");
    expect(aacArgs).toContain("stereo");
  });

  it("applies subtitle strategies consistently to vf chain and -sn flag", () => {
    const baseFilters: FilterConfig = {
      scale: "1280:-2",
      fps: 30,
    };

    const burnIn: SubtitlesConfig = {
      strategy: "burn_in",
      burnInFilter: "subtitles=INPUT:si=0",
    };

    const burnCmd = buildFfmpegCommandFromStructured(
      makeInput({
        filters: makeBaseFilters(baseFilters),
        subtitles: burnIn,
      }),
    );
    const burnArgs = splitArgs(burnCmd);
    const vfIndex = burnArgs.indexOf("-vf");
    expect(vfIndex).toBeGreaterThan(-1);
    const vfValue = burnArgs[vfIndex + 1];
    expect(vfValue).toContain("scale=1280:-2");
    expect(vfValue).toContain("fps=30");
    expect(vfValue).toContain("subtitles=INPUT:si=0");
    expect(burnArgs).not.toContain("-sn");

    const dropCmd = buildFfmpegCommandFromStructured(
      makeInput({
        filters: makeBaseFilters(baseFilters),
        subtitles: { strategy: "drop" },
      }),
    );
    const dropArgs = splitArgs(dropCmd);
    expect(dropArgs).toContain("-sn");
  });

  it("does not emit -vf or -filter_complex when encoder=copy even if video filters are set", () => {
    const cmd = buildFfmpegCommandFromStructured(
      makeInput({
        video: makeBaseVideo({
          encoder: "copy",
          rateControl: "cbr",
        }),
        filters: makeBaseFilters({
          scale: "1280:-2",
          crop: "iw:ih-100:0:100",
          fps: 30,
          vfChain: "eq=contrast=1.1:brightness=0.05",
          filterComplex: "[0:v]scale=1280:-2[scaled]",
        }),
      }),
    );
    const args = splitArgs(cmd);
    const joined = ` ${args.join(" ")} `;

    expect(joined).toContain(" -c:v copy ");
    expect(joined).not.toContain(" -vf ");
    expect(joined).not.toContain(" -filter_complex ");
  });

  it("does not emit -af when audio codec is copy even if afChain is set", () => {
    const cmd = buildFfmpegCommandFromStructured(
      makeInput({
        audio: {
          codec: "copy",
          bitrate: 192,
          sampleRateHz: 44100,
          channels: 2,
          channelLayout: "stereo",
        } as AudioConfig,
        filters: makeBaseFilters({
          afChain: "acompressor=threshold=-18dB",
        }),
      }),
    );

    const args = splitArgs(cmd);
    const joined = ` ${args.join(" ")} `;

    expect(joined).toContain(" -c:a copy ");
    expect(joined).not.toContain(" -af ");
  });

  it("supports documented CRF/CQ ranges for x264/NVENC/AV1 encoders", () => {
    // x264 CRF 0 and 51
    const crf0 = buildFfmpegCommandFromStructured(
      makeInput({
        video: makeBaseVideo({
          encoder: "libx264",
          rateControl: "crf",
          qualityValue: 0,
        }),
      }),
    );
    expect(crf0).toContain("-crf 0");

    const crf51 = buildFfmpegCommandFromStructured(
      makeInput({
        video: makeBaseVideo({
          encoder: "libx264",
          rateControl: "crf",
          qualityValue: 51,
        }),
      }),
    );
    expect(crf51).toContain("-crf 51");

    // NVENC CQ 0 and 51
    const cq0 = buildFfmpegCommandFromStructured(
      makeInput({
        video: makeBaseVideo({
          encoder: "hevc_nvenc",
          rateControl: "cq",
          qualityValue: 0,
        }),
      }),
    );
    expect(cq0).toContain("-cq 0");

    const cq51 = buildFfmpegCommandFromStructured(
      makeInput({
        video: makeBaseVideo({
          encoder: "hevc_nvenc",
          rateControl: "cq",
          qualityValue: 51,
        }),
      }),
    );
    expect(cq51).toContain("-cq 51");

    // AV1 CRF 0 and 63
    const av1Crf0 = buildFfmpegCommandFromStructured(
      makeInput({
        video: makeBaseVideo({
          encoder: "libsvtav1",
          rateControl: "crf",
          qualityValue: 0,
        }),
      }),
    );
    expect(av1Crf0).toContain("-crf 0");

    const av1Crf63 = buildFfmpegCommandFromStructured(
      makeInput({
        video: makeBaseVideo({
          encoder: "libsvtav1",
          rateControl: "crf",
          qualityValue: 63,
        }),
      }),
    );
    expect(av1Crf63).toContain("-crf 63");
  });
});
