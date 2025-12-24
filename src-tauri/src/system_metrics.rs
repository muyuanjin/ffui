use std::collections::VecDeque;
use std::sync::atomic::{
    AtomicUsize,
    Ordering,
};
use std::sync::{
    Arc,
    Condvar,
    Mutex,
};
use std::thread;
use std::time::{
    Duration,
    Instant,
    SystemTime,
    UNIX_EPOCH,
};

use serde::{
    Deserialize,
    Serialize,
};
use sysinfo::{
    NetworkData,
    Networks,
    System,
};
use tauri::{
    AppHandle,
    Emitter,
    Manager,
};

use crate::ffui_core::{
    AppSettings,
    DEFAULT_METRICS_INTERVAL_MS,
    GpuUsageSnapshot,
    TranscodingEngine,
    sample_gpu_usage,
};
use crate::sync_ext::{
    CondvarExt,
    MutexExt,
};

/// Canonical event name for streaming system metrics snapshots.
pub const METRICS_EVENT_NAME: &str = "system-metrics://update";

const DEFAULT_HISTORY_CAPACITY: usize = 600; // ~10 minutes at 1s interval
const DEFAULT_SAMPLING_INTERVAL_MS: u64 = DEFAULT_METRICS_INTERVAL_MS as u64;
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
    /// OS uptime in seconds.
    pub uptime_seconds: u64,
    pub cpu: CpuMetrics,
    pub memory: MemoryMetrics,
    pub disk: DiskMetrics,
    pub network: NetworkMetrics,
    /// Optional NVIDIA GPU metrics (when available).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gpu: Option<GpuUsageSnapshot>,
}

#[derive(Debug, Clone)]
pub struct MetricsConfig {
    pub sampling_interval: Duration,
    #[allow(dead_code)]
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
        let base_interval_ms = match std::env::var("FFUI_METRICS_INTERVAL_MS") {
            Ok(value) => value.parse::<u64>().unwrap_or(DEFAULT_SAMPLING_INTERVAL_MS),
            Err(_) => DEFAULT_SAMPLING_INTERVAL_MS,
        };
        Self {
            sampling_interval: Duration::from_millis(base_interval_ms),
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
    wake_lock: Mutex<()>,
    wake_cv: Condvar,
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
                wake_lock: Mutex::new(()),
                wake_cv: Condvar::new(),
            }),
        }
    }

    pub fn config(&self) -> MetricsConfig {
        self.inner.config.clone()
    }

    pub fn push_snapshot(&self, snapshot: MetricsSnapshot) {
        let mut history = self.inner.history.lock_unpoisoned();
        let capacity = self.inner.config.history_capacity;
        if history.len() >= capacity {
            history.pop_front();
        }
        history.push_back(snapshot);
    }

    pub fn history(&self) -> Vec<MetricsSnapshot> {
        let history = self.inner.history.lock_unpoisoned();
        history.iter().cloned().collect()
    }

    pub fn subscribe(&self) {
        self.inner.subscribers.fetch_add(1, Ordering::Relaxed);
        // Wake the sampler so that a newly opened monitor tab starts receiving
        // snapshots immediately instead of waiting for the idle sleep timeout.
        self.inner.wake_cv.notify_all();
    }

    pub fn unsubscribe(&self) {
        let _ =
            self.inner
                .subscribers
                .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |current| {
                    Some(current.saturating_sub(1))
                });
    }

    pub(crate) fn wait_for_wakeup_or_timeout(&self, timeout: Duration) {
        let guard = self.inner.wake_lock.lock_unpoisoned();
        let _ = self.inner.wake_cv.wait_timeout_unpoisoned(guard, timeout);
    }

    #[allow(dead_code)]
    pub fn subscriber_count(&self) -> usize {
        self.inner.subscribers.load(Ordering::Relaxed)
    }
}

impl Default for MetricsState {
    fn default() -> Self {
        Self::new(MetricsConfig::default())
    }
}

/// Apply user-configured overrides from AppSettings onto the metrics config.
/// This is kept in a small helper to make the behaviour easy to test without
/// needing a full Tauri AppHandle.
fn apply_settings_overrides(config: &mut MetricsConfig, settings: &AppSettings) {
    if let Some(ms) = settings.metrics_interval_ms {
        // Clamp to a sensible floor to avoid busy-looping the sampler thread.
        let clamped_ms = ms.max(100) as u64;
        config.sampling_interval = Duration::from_millis(clamped_ms);
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SamplingMode {
    Active(Duration),
    Idle(Duration),
}

fn sampling_mode(subscribers: usize, config: &MetricsConfig) -> SamplingMode {
    if subscribers == 0 {
        SamplingMode::Idle(config.idle_interval)
    } else {
        SamplingMode::Active(config.sampling_interval)
    }
}

fn seed_sysinfo_if_needed(
    subscribers: usize,
    sys: &mut Option<System>,
    networks: &mut Option<Networks>,
    last_instant: &mut Option<Instant>,
) -> bool {
    if subscribers == 0 || sys.is_some() {
        return false;
    }

    // sysinfo's `System::new_all + refresh_all` does a fair amount of CPU/IO
    // work. Defer it until we have at least one subscriber so startup does
    // not contend with WebView2 / frontend initialization.
    let mut seeded = System::new_all();
    seeded.refresh_all();
    *sys = Some(seeded);
    *networks = Some(Networks::new_with_refreshed_list());
    *last_instant = Some(Instant::now());
    true
}

/// Spawn the background sampler thread.
pub fn spawn_metrics_sampler(app_handle: AppHandle, metrics_state: MetricsState) {
    // This sampler is a long-lived loop; run it on a dedicated OS thread so it
    // does not permanently occupy Tokio's blocking thread pool.
    let _ = thread::Builder::new()
        .name("ffui-metrics-sampler".to_string())
        .spawn(move || {
            let mut sys: Option<System> = None;
            let mut networks: Option<Networks> = None;
            let mut last_instant: Option<Instant> = None;

            loop {
                // Prefer user-configured interval from AppSettings when available.
                let mut config = metrics_state.config();
                if let Some(engine_state) = app_handle.try_state::<TranscodingEngine>() {
                    let settings_snapshot = engine_state.settings();
                    apply_settings_overrides(&mut config, &settings_snapshot);
                }

                let subscribers = metrics_state.subscriber_count();
                match sampling_mode(subscribers, &config) {
                    SamplingMode::Idle(idle_interval) => {
                        metrics_state.wait_for_wakeup_or_timeout(idle_interval);
                        continue;
                    }
                    SamplingMode::Active(sampling_interval) => {
                        let _ = seed_sysinfo_if_needed(
                            subscribers,
                            &mut sys,
                            &mut networks,
                            &mut last_instant,
                        );

                        let (Some(sys), Some(networks)) = (sys.as_mut(), networks.as_mut()) else {
                            continue;
                        };

                        let now = Instant::now();
                        let elapsed = last_instant
                            .replace(now)
                            .map(|prev| now.saturating_duration_since(prev))
                            .unwrap_or(sampling_interval);

                        let dt = if elapsed.is_zero() {
                            sampling_interval
                        } else {
                            elapsed
                        };

                        let snapshot = sample_metrics(sys, networks, dt, &config);
                        metrics_state.push_snapshot(snapshot.clone());

                        if let Err(err) = app_handle.emit(METRICS_EVENT_NAME, snapshot) {
                            eprintln!("failed to emit system metrics event: {err}");
                        }

                        metrics_state.wait_for_wakeup_or_timeout(sampling_interval);
                    }
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
    let uptime_seconds = System::uptime();

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

    // GPU: reuse the existing NVML-based sampler so that performance
    // monitoring uses the same logic as the legacy get_gpu_usage command.
    // Any initialization errors are encapsulated inside the snapshot.
    let gpu = Some(sample_gpu_usage());

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis() as u64;

    MetricsSnapshot {
        timestamp,
        uptime_seconds,
        cpu,
        memory,
        disk,
        network,
        gpu,
    }
}

#[cfg(test)]
mod tests;
