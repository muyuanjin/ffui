use std::collections::VecDeque;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicUsize, Ordering},
};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sysinfo::{NetworkData, Networks, System};
use tauri::{AppHandle, Emitter};

/// Canonical event name for streaming system metrics snapshots.
pub const METRICS_EVENT_NAME: &str = "system-metrics://update";

const DEFAULT_HISTORY_CAPACITY: usize = 600; // ~10 minutes at 1s interval
const DEFAULT_SAMPLING_INTERVAL_MS: u64 = 1_000;
const DEFAULT_IDLE_INTERVAL_MS: u64 = 5_000;
const DEFAULT_MAX_DISKS: usize = 6;
const DEFAULT_MAX_INTERFACES: usize = 6;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuMetrics {
    /// Per-core utilization in [0.0, 100.0].
    pub cores: Vec<f32>,
    /// Aggregate utilization in [0.0, 100.0].
    pub total: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryMetrics {
    /// Used memory in bytes.
    pub used_bytes: u64,
    /// Total memory in bytes.
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskIoMetrics {
    /// Device name (for example "C:" on Windows, or "/dev/sda1" on Unix).
    pub device: String,
    /// Read throughput in bytes per second.
    pub read_bps: u64,
    /// Write throughput in bytes per second.
    pub write_bps: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskMetrics {
    pub io: Vec<DiskIoMetrics>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkInterfaceMetrics {
    /// Interface name (for example "eth0" or "Wi-Fi").
    pub name: String,
    /// Receive throughput in bytes per second.
    pub rx_bps: u64,
    /// Transmit throughput in bytes per second.
    pub tx_bps: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkMetrics {
    pub interfaces: Vec<NetworkInterfaceMetrics>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricsSnapshot {
    /// UNIX timestamp in milliseconds.
    pub timestamp: u64,
    pub cpu: CpuMetrics,
    pub memory: MemoryMetrics,
    pub disk: DiskMetrics,
    pub network: NetworkMetrics,
}

#[derive(Debug, Clone)]
pub struct MetricsConfig {
    pub sampling_interval: Duration,
    pub idle_interval: Duration,
    pub history_capacity: usize,
    pub max_disks: usize,
    pub max_interfaces: usize,
}

fn env_u64(name: &str, default: u64) -> u64 {
    match std::env::var(name) {
        Ok(value) => value.parse::<u64>().unwrap_or(default),
        Err(_) => default,
    }
}

fn env_usize(name: &str, default: usize) -> usize {
    match std::env::var(name) {
        Ok(value) => value.parse::<usize>().unwrap_or(default),
        Err(_) => default,
    }
}

impl Default for MetricsConfig {
    fn default() -> Self {
        Self {
            sampling_interval: Duration::from_millis(env_u64(
                "FFUI_METRICS_INTERVAL_MS",
                DEFAULT_SAMPLING_INTERVAL_MS,
            )),
            idle_interval: Duration::from_millis(env_u64(
                "FFUI_METRICS_IDLE_INTERVAL_MS",
                DEFAULT_IDLE_INTERVAL_MS,
            )),
            history_capacity: env_usize("FFUI_METRICS_HISTORY_CAPACITY", DEFAULT_HISTORY_CAPACITY),
            max_disks: env_usize("FFUI_METRICS_MAX_DISKS", DEFAULT_MAX_DISKS),
            max_interfaces: env_usize("FFUI_METRICS_MAX_INTERFACES", DEFAULT_MAX_INTERFACES),
        }
    }
}

#[derive(Debug)]
struct InnerMetricsState {
    history: Mutex<VecDeque<MetricsSnapshot>>,
    config: MetricsConfig,
    subscribers: AtomicUsize,
}

/// Shared metrics state stored in Tauri `State`.
#[derive(Clone, Debug)]
pub struct MetricsState {
    inner: Arc<InnerMetricsState>,
}

impl MetricsState {
    pub fn new(config: MetricsConfig) -> Self {
        let capacity = config.history_capacity;
        Self {
            inner: Arc::new(InnerMetricsState {
                history: Mutex::new(VecDeque::with_capacity(capacity)),
                config,
                subscribers: AtomicUsize::new(0),
            }),
        }
    }

    pub fn default() -> Self {
        Self::new(MetricsConfig::default())
    }

    pub fn config(&self) -> MetricsConfig {
        self.inner.config.clone()
    }

    pub fn push_snapshot(&self, snapshot: MetricsSnapshot) {
        let mut history = self
            .inner
            .history
            .lock()
            .expect("system metrics history lock poisoned");
        let capacity = self.inner.config.history_capacity;
        if history.len() >= capacity {
            history.pop_front();
        }
        history.push_back(snapshot);
    }

    pub fn history(&self) -> Vec<MetricsSnapshot> {
        let history = self
            .inner
            .history
            .lock()
            .expect("system metrics history lock poisoned");
        history.iter().cloned().collect()
    }

    pub fn subscribe(&self) {
        self.inner.subscribers.fetch_add(1, Ordering::Relaxed);
    }

    pub fn unsubscribe(&self) {
        let _ =
            self.inner
                .subscribers
                .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |current| {
                    Some(current.saturating_sub(1))
                });
    }

    pub fn subscriber_count(&self) -> usize {
        self.inner.subscribers.load(Ordering::Relaxed)
    }
}

/// Spawn the background sampler task on Tauri's async runtime.
pub fn spawn_metrics_sampler(app_handle: AppHandle, metrics_state: MetricsState) {
    tauri::async_runtime::spawn_blocking(move || {
        let mut sys = System::new_all();
        sys.refresh_all();
        let mut networks = Networks::new_with_refreshed_list();

        let mut last_instant = Instant::now();

        loop {
            let config = metrics_state.config();
            let subscribers = metrics_state.subscriber_count();

            let now = Instant::now();
            let elapsed = now.saturating_duration_since(last_instant);
            last_instant = now;

            if subscribers > 0 {
                let dt = if elapsed.is_zero() {
                    config.sampling_interval
                } else {
                    elapsed
                };

                let snapshot = sample_metrics(&mut sys, &mut networks, dt, &config);
                metrics_state.push_snapshot(snapshot.clone());

                if let Err(err) = app_handle.emit(METRICS_EVENT_NAME, snapshot) {
                    eprintln!("failed to emit system metrics event: {err}");
                }

                std::thread::sleep(config.sampling_interval);
            } else {
                std::thread::sleep(config.idle_interval);
            }
        }
    });
}

fn sample_metrics(
    sys: &mut System,
    networks: &mut Networks,
    dt: Duration,
    config: &MetricsConfig,
) -> MetricsSnapshot {
    // Refresh CPU and memory.
    sys.refresh_cpu_usage();
    sys.refresh_memory();

    let cores: Vec<f32> = sys.cpus().iter().map(|cpu| cpu.cpu_usage()).collect();
    let total = if cores.is_empty() {
        0.0
    } else {
        cores.iter().copied().sum::<f32>() / cores.len() as f32
    };
    let cpu = CpuMetrics { cores, total };

    let total_memory = sys.total_memory();
    let used_memory = sys.used_memory();
    let memory = MemoryMetrics {
        used_bytes: used_memory,
        total_bytes: total_memory,
    };

    let dt_secs = dt.as_secs_f64().max(0.001);

    // Disks: approximate system-wide throughput by aggregating per-process disk usage.
    sys.refresh_processes();
    let mut total_read_bytes: u64 = 0;
    let mut total_written_bytes: u64 = 0;
    for process in sys.processes().values() {
        let usage = process.disk_usage();
        total_read_bytes = total_read_bytes.saturating_add(usage.read_bytes);
        total_written_bytes = total_written_bytes.saturating_add(usage.written_bytes);
    }

    let mut disk_rows: Vec<DiskIoMetrics> = Vec::new();
    if total_read_bytes > 0 || total_written_bytes > 0 {
        let read_bps = (total_read_bytes as f64 / dt_secs) as u64;
        let write_bps = (total_written_bytes as f64 / dt_secs) as u64;
        disk_rows.push(DiskIoMetrics {
            device: "total".to_string(),
            read_bps,
            write_bps,
        });
    }
    if disk_rows.len() > config.max_disks {
        disk_rows.truncate(config.max_disks);
    }
    let disk = DiskMetrics { io: disk_rows };

    // Network: refresh and compute Bps from delta counters.
    networks.refresh();
    let mut iface_rows: Vec<NetworkInterfaceMetrics> = networks
        .iter()
        .map(|(name, data): (&String, &NetworkData)| {
            let rx_bps = (data.received() as f64 / dt_secs) as u64;
            let tx_bps = (data.transmitted() as f64 / dt_secs) as u64;
            NetworkInterfaceMetrics {
                name: name.clone(),
                rx_bps,
                tx_bps,
            }
        })
        .collect();

    iface_rows.sort_by(|a, b| {
        (b.rx_bps + b.tx_bps)
            .cmp(&(a.rx_bps + a.tx_bps))
            .then_with(|| a.name.cmp(&b.name))
    });
    if iface_rows.len() > config.max_interfaces {
        iface_rows.truncate(config.max_interfaces);
    }
    let network = NetworkMetrics {
        interfaces: iface_rows,
    };

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis() as u64;

    MetricsSnapshot {
        timestamp,
        cpu,
        memory,
        disk,
        network,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn ring_buffer_is_bounded() {
        let config = MetricsConfig {
            history_capacity: 3,
            ..MetricsConfig::default()
        };
        let state = MetricsState::new(config.clone());

        for i in 0..10 {
            state.push_snapshot(MetricsSnapshot {
                timestamp: i,
                cpu: CpuMetrics {
                    cores: vec![0.0],
                    total: 0.0,
                },
                memory: MemoryMetrics {
                    used_bytes: 0,
                    total_bytes: 0,
                },
                disk: DiskMetrics { io: Vec::new() },
                network: NetworkMetrics {
                    interfaces: Vec::new(),
                },
            });
        }

        let history = state.history();
        assert_eq!(history.len(), 3, "history must be bounded by capacity");
        assert_eq!(
            history.first().unwrap().timestamp,
            7,
            "oldest snapshot should be kept within capacity window"
        );
        assert_eq!(
            history.last().unwrap().timestamp,
            9,
            "latest snapshot should be present"
        );
    }

    #[test]
    fn metrics_config_defaults_are_reasonable() {
        let config = MetricsConfig::default();
        assert!(config.history_capacity >= 100);
        assert!(config.sampling_interval >= Duration::from_millis(200));
        assert!(config.idle_interval >= config.sampling_interval);
        assert!(config.max_disks > 0);
        assert!(config.max_interfaces > 0);
    }

    #[test]
    fn sample_metrics_produces_sane_values() {
        let mut sys = System::new_all();
        let mut networks = Networks::new_with_refreshed_list();
        let config = MetricsConfig::default();

        let snapshot = sample_metrics(&mut sys, &mut networks, Duration::from_secs(1), &config);

        assert!(
            (0.0..=100.0).contains(&snapshot.cpu.total),
            "CPU total must be in [0, 100], got {}",
            snapshot.cpu.total
        );
        assert!(
            snapshot.memory.total_bytes >= snapshot.memory.used_bytes,
            "total memory must be >= used memory"
        );
    }

    #[test]
    fn metrics_snapshot_json_contract_matches_spec() {
        let snapshot = MetricsSnapshot {
            timestamp: 1710000000000,
            cpu: CpuMetrics {
                cores: vec![12.0, 34.0],
                total: 23.0,
            },
            memory: MemoryMetrics {
                used_bytes: 123,
                total_bytes: 456,
            },
            disk: DiskMetrics {
                io: vec![DiskIoMetrics {
                    device: "C:".to_string(),
                    read_bps: 1_048_576,
                    write_bps: 524_288,
                }],
            },
            network: NetworkMetrics {
                interfaces: vec![NetworkInterfaceMetrics {
                    name: "eth0".to_string(),
                    rx_bps: 2_097_152,
                    tx_bps: 1_048_576,
                }],
            },
        };

        let value: Value =
            serde_json::to_value(&snapshot).expect("metrics snapshot should serialize to JSON");

        assert!(value.get("timestamp").is_some(), "timestamp field missing");
        assert!(
            value["cpu"]["cores"].is_array(),
            "cpu.cores must be an array in JSON"
        );
        assert!(
            value["cpu"]["total"].is_number(),
            "cpu.total must be a number in JSON"
        );

        assert!(
            value["memory"]["usedBytes"].is_number(),
            "memory.usedBytes must be a number in JSON (camelCase)"
        );
        assert!(
            value["memory"]["totalBytes"].is_number(),
            "memory.totalBytes must be a number in JSON (camelCase)"
        );

        assert!(
            value["disk"]["io"].is_array(),
            "disk.io must be an array in JSON"
        );

        let disk0 = &value["disk"]["io"][0];
        assert!(
            disk0["device"].is_string(),
            "disk.io[0].device must be string"
        );
        assert!(
            disk0["readBps"].is_number(),
            "disk.io[0].readBps must be number (camelCase)"
        );
        assert!(
            disk0["writeBps"].is_number(),
            "disk.io[0].writeBps must be number (camelCase)"
        );

        let iface0 = &value["network"]["interfaces"][0];
        assert!(
            iface0["name"].is_string(),
            "network.interfaces[0].name must be string"
        );
        assert!(
            iface0["rxBps"].is_number(),
            "network.interfaces[0].rxBps must be number"
        );
        assert!(
            iface0["txBps"].is_number(),
            "network.interfaces[0].txBps must be number"
        );
    }
}
