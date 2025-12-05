<script setup lang="ts">
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CpuUsageSnapshot, GpuUsageSnapshot } from "@/types";

defineProps<{
  /** CPU usage snapshot from backend */
  cpuSnapshot: CpuUsageSnapshot | null;
  /** GPU usage snapshot from backend */
  gpuSnapshot: GpuUsageSnapshot | null;
}>();
</script>

<template>
  <section class="max-w-4xl mx-auto py-12 text-sm text-muted-foreground">
    <div class="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle class="text-sm">CPU</CardTitle>
        </CardHeader>
        <CardContent class="text-xs space-y-2">
          <p v-if="cpuSnapshot">
            当前总使用率：
            <span class="font-mono text-foreground">
              {{ cpuSnapshot.overall.toFixed(1) }}%
            </span>
          </p>
          <p v-else>等待从后端获取 CPU 使用率...</p>
          <div
            v-if="cpuSnapshot"
            class="flex flex-wrap gap-1 mt-2"
          >
            <span
              v-for="(core, idx) in cpuSnapshot.perCore"
              :key="idx"
              class="px-1.5 py-0.5 rounded bg-muted text-foreground/80 font-mono"
            >
              C{{ idx }}: {{ core.toFixed(0) }}%
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle class="text-sm">GPU (NVIDIA / NVML)</CardTitle>
        </CardHeader>
        <CardContent class="text-xs space-y-2">
          <div v-if="gpuSnapshot">
            <p v-if="gpuSnapshot.available">
              GPU 使用率：
              <span class="font-mono text-foreground">
                {{ gpuSnapshot.gpuPercent ?? 0 }}%
              </span>
            </p>
            <p v-if="gpuSnapshot.available && gpuSnapshot.memoryPercent !== undefined">
              显存使用率：
              <span class="font-mono text-foreground">
                {{ gpuSnapshot.memoryPercent }}%
              </span>
            </p>
            <p v-if="!gpuSnapshot.available">
              {{ gpuSnapshot.error ?? "未检测到 NVIDIA GPU，或 NVML 不可用。" }}
            </p>
          </div>
          <p v-else>等待从后端获取 GPU 使用率...</p>
        </CardContent>
      </Card>
    </div>
  </section>
</template>
