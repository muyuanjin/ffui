import { describe, expect, it } from "vitest";
import { parseVqResultsDataJs } from "./parser";

describe("parseVqResultsDataJs", () => {
  it("extracts bitrate-vmaf/ssim/fps datasets with points", () => {
    const input = `
const data_1__bitrate_vmaf__x264_medium_crf = {
  label: " x264 medium crf",
  data: [
    { x: 2000.0, y: 95.5 },
    { x: 1000.0, y: 90.0 }
  ]
};

const data_2__bitrate_ssim__x264_medium_crf = {
  label: " x264 medium crf",
  data: [
    { x: 1000.0, y: 0.99 },
    { x: 2000.0, y: 0.995 }
  ]
};

const data_1__bitrate_vmaf_rtx4080_NVEncC_HEVC_quality = {
  label: " rtx4080 NVENC HEVC quality",
  data: [
    { x: 1000.0, y: 93.0 },
    { x: 2000.0, y: 95.0 }
  ]
};
`;

    const datasets = parseVqResultsDataJs(input);
    expect(datasets.length).toBe(3);

    const vmaf = datasets.find((d) => d.metric === "vmaf");
    expect(vmaf?.set).toBe(1);
    expect(vmaf?.key).toBe("x264_medium_crf");
    expect(vmaf?.points[0]?.x).toBe(1000);
    expect(vmaf?.points[1]?.x).toBe(2000);

    const ssim = datasets.find((d) => d.metric === "ssim");
    expect(ssim?.set).toBe(2);
    expect(ssim?.points[0]?.x).toBe(1000);
    expect(ssim?.points[1]?.x).toBe(2000);

    const nvenc = datasets.find((d) => d.key === "rtx4080_NVEncC_HEVC_quality");
    expect(nvenc?.metric).toBe("vmaf");
  });
});
