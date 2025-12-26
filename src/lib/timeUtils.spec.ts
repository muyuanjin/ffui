// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { formatElapsedTime, estimateTotalTime, estimateRemainingTime, computeJobElapsedMs } from "./timeUtils";

describe("timeUtils", () => {
  describe("formatElapsedTime", () => {
    it("returns '-' for null, undefined, or non-positive values", () => {
      expect(formatElapsedTime(null)).toBe("-");
      expect(formatElapsedTime(undefined)).toBe("-");
      expect(formatElapsedTime(0)).toBe("-");
      expect(formatElapsedTime(-1000)).toBe("-");
      expect(formatElapsedTime(NaN)).toBe("-");
    });

    it("formats seconds correctly without hours", () => {
      expect(formatElapsedTime(5000)).toBe("0:05");
      expect(formatElapsedTime(65000)).toBe("1:05");
      expect(formatElapsedTime(3599000)).toBe("59:59");
    });

    it("formats with hours when duration exceeds 1 hour", () => {
      expect(formatElapsedTime(3600000)).toBe("1:00:00");
      expect(formatElapsedTime(3661000)).toBe("1:01:01");
      expect(formatElapsedTime(7325000)).toBe("2:02:05");
    });
  });

  describe("estimateTotalTime", () => {
    it("returns null for invalid inputs", () => {
      expect(estimateTotalTime(null, 50)).toBeNull();
      expect(estimateTotalTime(60000, null)).toBeNull();
      expect(estimateTotalTime(0, 50)).toBeNull();
      expect(estimateTotalTime(60000, 0)).toBeNull();
      expect(estimateTotalTime(60000, 100)).toBeNull();
      expect(estimateTotalTime(60000, 101)).toBeNull();
    });

    it("calculates estimated total time correctly", () => {
      // 50% 进度用了 60 秒，预估总时间 120 秒
      expect(estimateTotalTime(60000, 50)).toBe(120000);
      // 25% 进度用了 30 秒，预估总时间 120 秒
      expect(estimateTotalTime(30000, 25)).toBe(120000);
    });
  });

  describe("estimateRemainingTime", () => {
    it("returns null for invalid inputs", () => {
      expect(estimateRemainingTime(null, 50)).toBeNull();
      expect(estimateRemainingTime(60000, null)).toBeNull();
    });

    it("calculates remaining time correctly", () => {
      // 50% 进度用了 60 秒，剩余 60 秒
      expect(estimateRemainingTime(60000, 50)).toBe(60000);
      // 75% 进度用了 90 秒，预估总时间 120 秒，剩余 30 秒
      expect(estimateRemainingTime(90000, 75)).toBe(30000);
    });
  });

  describe("computeJobElapsedMs", () => {
    const nowMs = 1700000000000;
    const processingStart = nowMs - 20000;

    it("returns elapsedMs for completed jobs", () => {
      const job = {
        status: "completed",
        startTime: nowMs - 60000,
        endTime: nowMs,
        elapsedMs: 55000, // 优先使用 elapsedMs
      };
      expect(computeJobElapsedMs(job, nowMs)).toBe(55000);
    });

    it("falls back to startTime/endTime for completed jobs without elapsedMs", () => {
      const job = {
        status: "completed",
        startTime: nowMs - 60000,
        endTime: nowMs,
      };
      expect(computeJobElapsedMs(job, nowMs)).toBe(60000);
    });

    it("returns elapsedMs for paused jobs", () => {
      const job = {
        status: "paused",
        startTime: nowMs - 120000,
        elapsedMs: 60000,
      };
      expect(computeJobElapsedMs(job, nowMs)).toBe(60000);
    });

    it("returns elapsedMs for processing jobs when available", () => {
      const job = {
        status: "processing",
        startTime: nowMs - 30000,
        elapsedMs: 25000, // 后端提供的累计时间
      };
      expect(computeJobElapsedMs(job, nowMs)).toBe(25000);
    });

    it("falls back to startTime for processing jobs without elapsedMs", () => {
      const job = {
        status: "processing",
        startTime: nowMs - 30000,
      };
      expect(computeJobElapsedMs(job, nowMs)).toBe(30000);
    });

    it("prefers processingStartedMs over startTime when elapsedMs is missing", () => {
      const job = {
        status: "processing",
        startTime: nowMs - 60000,
        processingStartedMs: processingStart,
      };
      expect(computeJobElapsedMs(job, nowMs)).toBe(20000);
    });

    it("uses processingStartedMs for completed jobs when elapsedMs is missing", () => {
      const job = {
        status: "completed",
        startTime: nowMs - 60000,
        endTime: nowMs,
        processingStartedMs: processingStart,
      };
      expect(computeJobElapsedMs(job, nowMs)).toBe(20000);
    });

    it("returns null for queued jobs", () => {
      const job = {
        status: "queued",
        startTime: nowMs - 10000,
      };
      expect(computeJobElapsedMs(job, nowMs)).toBeNull();
    });
  });
});
