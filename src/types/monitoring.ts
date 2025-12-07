export interface CpuUsageSnapshot {
  overall: number;
  perCore: number[];
}

export interface GpuUsageSnapshot {
  available: boolean;
  gpuPercent?: number;
  memoryPercent?: number;
  error?: string;
}

// ----- System performance monitoring (system-metrics://update) -----

export interface CpuMetrics {
  cores: number[];
  total: number;
}

export interface MemoryMetrics {
  usedBytes: number;
  totalBytes: number;
}

export interface DiskIoMetrics {
  device: string;
  readBps: number;
  writeBps: number;
}

export interface DiskMetrics {
  io: DiskIoMetrics[];
}

export interface NetworkInterfaceMetrics {
  name: string;
  rxBps: number;
  txBps: number;
}

export interface NetworkMetrics {
  interfaces: NetworkInterfaceMetrics[];
}

export interface SystemMetricsSnapshot {
  timestamp: number;
  cpu: CpuMetrics;
  memory: MemoryMetrics;
  disk: DiskMetrics;
  network: NetworkMetrics;
  /** Optional NVIDIA GPU usage snapshot sampled alongside system metrics. */
  gpu?: GpuUsageSnapshot;
}
