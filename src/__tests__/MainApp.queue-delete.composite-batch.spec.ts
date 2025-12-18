// @vitest-environment jsdom
/**
 * 测试：通过右键菜单删除复合任务（Batch Compress 批次）
 *
 * 场景：用户右键点击复合任务卡片，选择“从列表删除”，
 * 前端应该调用新的 delete_batch_compress_batch 批量删除命令，后端成功时
 * 视为该批次所有终态子任务已从队列中移除。
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

  it("右键复合任务卡片后删除，应该调用 delete_batch_compress_batch 并视为整批成功删除", async () => {
    const batchId = "batch-composite-delete";

    // 模拟一个复合任务，包含多个已完成的子任务
    const jobs: TranscodeJob[] = [
      {
        id: "batch-compress-job-1",
        filename: "C:/videos/video1.mp4",
        type: "video",
        source: "batch_compress",
        originalSizeMB: 100,
        originalCodec: "h264",
        presetId: "p1",
        status: "completed",
        progress: 100,
        logs: [],
        batchId,
      } as any,
      {
        id: "batch-compress-job-2",
        filename: "C:/videos/video2.mp4",
        type: "video",
        source: "batch_compress",
        originalSizeMB: 80,
        originalCodec: "h264",
        presetId: "p1",
        status: "completed",
        progress: 100,
        logs: [],
        batchId,
      } as any,
      {
        id: "batch-compress-job-3",
        filename: "C:/videos/video3.mp4",
        type: "video",
        source: "batch_compress",
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

    useBackendMock({
      get_queue_state: () => ({ jobs: getQueueJobs() }),
      get_queue_state_lite: () => ({ jobs: getQueueJobs() }),
      get_app_settings: () => defaultAppSettings(),
      delete_batch_compress_batch: (payload) => {
        // 模拟后端批量删除成功
        expect((payload?.batchId ?? payload?.batch_id) as string).toBe(batchId);
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
    setSelectedJobIds(
      vm,
      jobs.map((job) => job.id),
    );

    // 触发批量删除（复合任务右键菜单 → 从列表删除）
    if (typeof vm.bulkDelete === "function") {
      await vm.bulkDelete();
    }
    await nextTick();

    // 验证：应调用一次 delete_batch_compress_batch，而不是对每个子任务逐个 delete_transcode_job。
    const deleteBatchCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === "delete_batch_compress_batch");
    expect(deleteBatchCalls.length).toBe(1);

    const singlePayload = deleteBatchCalls[0]?.[1] as any;
    expect(singlePayload).toMatchObject({
      batchId,
      batch_id: batchId,
    });

    // 验证：不应该有错误
    const error = vm.queueError ?? vm.queueError?.value ?? null;
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
        source: "batch_compress",
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
      delete_batch_compress_batch: () => {
        // 模拟后端批次删除返回 false（删除失败）
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
    const error = vm.queueError ?? vm.queueError?.value ?? null;
    const expectedError = (i18n as any).global.t("queue.error.deleteFailed") as string;
    expect(error).toBe(expectedError);

    wrapper.unmount();
  });
});
