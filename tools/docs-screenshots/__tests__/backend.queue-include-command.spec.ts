// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { loadQueueStateLite } from "../mocks/backend";

describe("docs-screenshots backend queue include-command", () => {
  it("omits ffmpegCommand by default for large queues", async () => {
    history.pushState({}, "", "?ffuiQueueJobs=3&ffuiQueueProcessingJobs=1");
    const state = await loadQueueStateLite();
    expect(state.jobs.length).toBe(3);
    expect(state.jobs[0]?.ffmpegCommand).toBeUndefined();
  });

  it("includes a long ffmpegCommand when ffuiQueueIncludeCommand=1", async () => {
    history.pushState({}, "", "?ffuiQueueJobs=3&ffuiQueueProcessingJobs=1&ffuiQueueIncludeCommand=1");
    const state = await loadQueueStateLite();
    expect(state.jobs.length).toBe(3);
    const cmd = state.jobs[0]?.ffmpegCommand;
    expect(typeof cmd).toBe("string");
    expect(cmd).toContain("-progress pipe:2");
    expect(cmd).toContain("-nostdin");
  });
});
