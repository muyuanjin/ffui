import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FFmpegPreset } from "@/types";
import { usePresetEditor } from "@/composables/usePresetEditor";
import { INITIAL_PRESETS } from "@/lib/initialPresets";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock, convertFileSrc: (path: string) => path }));
import { savePresetOnBackend } from "@/lib/backend";

describe("preset target declaration IPC", () => {
  beforeEach(() => invokeMock.mockReset());
  it("keeps output type metadata through editor normalization and backend save", async () => {
    const preset: FFmpegPreset = {
      ...INITIAL_PRESETS[0],
      advancedEnabled: true,
      ffmpegTemplate: "ffmpeg -i INPUT -filter_complex [0:a]volume=0.5[a] -map [a] -c:a aac -f mp4 OUTPUT",
      outputKind: "audio",
    };
    const editor = usePresetEditor({ initialPreset: preset });
    expect(editor.buildPresetFromState().outputKind).toBe("audio");
    editor.outputKind.value = "other";
    const saved = editor.buildPresetFromState();
    invokeMock.mockResolvedValueOnce(saved);
    await savePresetOnBackend(saved);
    expect(invokeMock).toHaveBeenCalledWith("save_preset", {
      preset: expect.objectContaining({ outputKind: "other", ffmpegTemplate: preset.ffmpegTemplate }),
    });
  });
});
