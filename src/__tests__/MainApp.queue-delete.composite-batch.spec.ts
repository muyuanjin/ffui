// @vitest-environment jsdom
/**
 * 测试：通过右键菜单删除复合任务（Smart Scan 批次）
 * 
 * 场景：用户右键点击复合任务卡片，选择"从列表删除"，
 * 前端应该为该批次的所有终态子任务发送删除请求，后端应该返回 true。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  i18n,
  useBackendMock,
  setQueueJobs,
  getQueueJobs,
  invokeMock,
  defaultAppSettings,
} from "./helpers/mainAppTauriDialog";
import { setSelectedJobIds } from "./helpers/queueSelection";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import MainApp from "@/MainApp.vue";
import type { TranscodeJob } from "@/types";

describe("MainApp 复合任务删除", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("右键复合任务卡片后删除，应该成功删除所有终态子任务", async () => {
    const batchId = "batch-composite-delete";
    
    // 模拟一个复合任务，包含多个已完成的子任务
    const jobs: TranscodeJob[] = [
      {
        id: "smart-scan-job-1",
        filename: "C:/videos/video1.mp4",
        type: "video",
        source: "smart_scan",
        originalSizeMB: 100,
        originalCodec: "h264",
        presetId: "p1",
        status: "completed",
        progress: 100,
        logs: [],
        batchId,
      } as any,
      {
        id: "smart-scan-job-2",
        filename: "C:/videos/video2.mp4",
        type: "video",
        source: "smart_scan",
        originalSizeMB: 80,
        originalCodec: "h264",
        presetId: "p1",
        status: "completed",
        progress: 100,
        logs: [],
        batchId,
      } as any,
      {
        id: "smart-scan-job-3",
        filename: "C:/videos/video3.mp4",
        type: "video",
        source: "smart_scan",
        originalSizeMB: 60,
        originalCodec: "h264",
        presetId: "p1",
        status: "failed",
        progress: 50,
        logs: [],
        batchId,
      } as any,
    ];

    setQueueJobs(jobs);

    const deletedIds: string[] = [];
    const deleteCallPayloads: any[] = [];

    useBackendMock({
      get_queue_state: () => ({ jobs: getQueueJobs() }),
      get_queue_state_lite: () => ({ jobs: getQueueJobs() }),
      get_app_settings: () => defaultAppSettings(),
      delete_transcode_job: (payload) => {
        deleteCallPayloads.push(payload);
        const id = (payload?.jobId ?? payload?.job_id) as string;
        deletedIds.push(id);
        // 模拟后端成功删除
        return true;
      },
    });

    const wrapper = mount(MainApp, {
      global: { plugins: [i18n] },
    });

    const vm: any = wrapper.vm;
    vm.activeTab = "queue";

    await nextTick();
    if (typeof vm.refreshQueueFromBackend === "function") {
      await vm.refreshQueueFromBackend();
    }
    await nextTick();

    // 模拟用户右键点击复合任务卡片后，选中该批次的所有子任务
    // （这是 handleBatchContextMenu 的行为）
    setSelectedJobIds(vm, jobs.map((job) => job.id));

    // 触发批量删除
    if (typeof vm.bulkDelete === "function") {
      await vm.bulkDelete();
    }
    await nextTick();

    // 验证：应该为所有终态子任务发送删除请求
    const deleteCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "delete_transcode_job"
    );
    
    // 所有 3 个任务都是终态（completed 或 failed），应该都被删除
    expect(deleteCalls.length).toBe(3);
    expect(new Set(deletedIds)).toEqual(new Set(jobs.map((job) => job.id)));

    // 验证：不应该有错误
    const error = (vm.queueError ?? vm.queueError?.value) ?? null;
    expect(error).toBeNull();

    wrapper.unmount();
  });

  it("当后端返回 false 时，应该显示删除失败错误", async () => {
    const batchId = "batch-delete-fail";
    
    const jobs: TranscodeJob[] = [
      {
        id: "job-fail-1",
        filename: "C:/videos/video1.mp4",
        type: "video",
        source: "smart_scan",
        originalSizeMB: 100,
        originalCodec: "h264",
        presetId: "p1",
        status: "completed",
        progress: 100,
        logs: [],
        batchId,
      } as any,
    ];

    setQueueJobs(jobs);

    useBackendMock({
      get_queue_state: () => ({ jobs: getQueueJobs() }),
      get_queue_state_lite: () => ({ jobs: getQueueJobs() }),
      get_app_settings: () => defaultAppSettings(),
      delete_transcode_job: () => {
        // 模拟后端返回 false（删除失败）
        return false;
      },
    });

    const wrapper = mount(MainApp, {
      global: { plugins: [i18n] },
    });

    const vm: any = wrapper.vm;
    vm.activeTab = "queue";

    await nextTick();
    if (typeof vm.refreshQueueFromBackend === "function") {
      await vm.refreshQueueFromBackend();
    }
    await nextTick();

    setSelectedJobIds(vm, ["job-fail-1"]);

    if (typeof vm.bulkDelete === "function") {
      await vm.bulkDelete();
    }
    await nextTick();

    // 验证：应该显示删除失败错误
    const error = (vm.queueError ?? vm.queueError?.value) ?? null;
    const expectedError = (i18n as any).global.t("queue.error.deleteFailed") as string;
    expect(error).toBe(expectedError);

    wrapper.unmount();
  });
});
