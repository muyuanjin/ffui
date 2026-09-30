import { reactive } from "vue";
import { describe, expect, it } from "vitest";
import { canReplayQueueJob, hasIndeterminateQueueProgress } from "./queueExecutionCapabilities";
import { createQueueContextMenuPermissions } from "@/components/main/queueContextMenu.permissions";

describe("queue execution capabilities", () => {
  it("keeps video replay but requires an explicit restart for transparent commands", () => {
    expect(canReplayQueueJob({ executionMode: "video" })).toBe(true);
    expect(canReplayQueueJob({ executionMode: "managed" })).toBe(true);
    expect(canReplayQueueJob({ executionMode: "transparent" })).toBe(false);
  });
  it("does not infer a percentage for generic FFmpeg executions", () => {
    expect(hasIndeterminateQueueProgress({ status: "processing", executionMode: "managed" })).toBe(true);
    expect(hasIndeterminateQueueProgress({ status: "processing", executionMode: "transparent" })).toBe(true);
    expect(hasIndeterminateQueueProgress({ status: "processing", executionMode: "video" })).toBe(false);
  });
  it("disables wait/resume in the context menu while allowing restart", () => {
    const props = reactive({
      mode: "single" as const,
      queueMode: "display" as const,
      jobStatus: "processing" as "processing" | "paused",
      hasSelection: false,
      jobExecutionMode: "transparent" as const,
    });
    const permissions = createQueueContextMenuPermissions(props);
    expect(permissions.canWait.value).toBe(false);
    props.jobStatus = "paused";
    expect(permissions.canResume.value).toBe(false);
    expect(permissions.canRestart.value).toBe(true);
  });
});
