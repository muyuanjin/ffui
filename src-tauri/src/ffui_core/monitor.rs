use std::sync::{
    Mutex,
    OnceLock,
};

use anyhow::Result;
use nvml_wrapper::Nvml;
use nvml_wrapper::error::NvmlError;
use serde::{
    Deserialize,
    Serialize,
};
use sysinfo::System;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuUsageSnapshot {
    pub overall: f32,
    pub per_core: Vec<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuUsageSnapshot {
    pub available: bool,
    pub gpu_percent: Option<u32>,
    pub memory_percent: Option<u32>,
    pub error: Option<String>,
}

pub fn sample_cpu_usage() -> CpuUsageSnapshot {
    // Reuse a single System instance across calls so that sysinfo's internal
    // baselines are warmed once instead of paying the initialization cost on
    // every IPC round-trip.
    static SYSTEM: OnceLock<Mutex<System>> = OnceLock::new();

    let mut sys = SYSTEM
        .get_or_init(|| {
            let mut sys = System::new();
            sys.refresh_cpu_usage();
            Mutex::new(sys)
        })
        .lock()
        .expect("cpu System mutex poisoned");
    sys.refresh_cpu_usage();

    let per_core: Vec<f32> = sys.cpus().iter().map(|c| c.cpu_usage()).collect();
    let overall = if per_core.is_empty() {
        0.0
    } else {
        per_core.iter().copied().sum::<f32>() / per_core.len() as f32
    };

    CpuUsageSnapshot { overall, per_core }
}

fn try_sample_gpu_usage() -> Result<GpuUsageSnapshot, NvmlError> {
    // NVML initialization is relatively expensive; keep a single shared instance
    // and reuse it across samples. If initialization fails once (e.g. no NVIDIA
    // GPU or missing drivers), subsequent calls will fail fast without repeatedly
    // hitting the driver.
    static NVML_INSTANCE: OnceLock<Mutex<Option<Nvml>>> = OnceLock::new();

    let mutex = NVML_INSTANCE.get_or_init(|| Mutex::new(None));
    let mut guard = mutex.lock().expect("NVML mutex poisoned");
    if guard.is_none() {
        match Nvml::init() {
            Ok(instance) => {
                *guard = Some(instance);
            }
            Err(e) => {
                return Err(e);
            }
        }
    }

    let nvml = guard.as_ref().expect("NVML instance must be initialized");
    let device_count = nvml.device_count()?;
    if device_count == 0 {
        return Ok(GpuUsageSnapshot {
            available: false,
            gpu_percent: None,
            memory_percent: None,
            error: Some("No NVIDIA GPUs detected".to_string()),
        });
    }

    let device = nvml.device_by_index(0)?;
    let util = device.utilization_rates()?;
    let memory = device.memory_info()?;
    let memory_percent = if memory.total > 0 {
        Some(((memory.used as f64 / memory.total as f64) * 100.0).round() as u32)
    } else {
        None
    };

    Ok(GpuUsageSnapshot {
        available: true,
        gpu_percent: Some(util.gpu),
        memory_percent,
        error: None,
    })
}

pub fn sample_gpu_usage() -> GpuUsageSnapshot {
    match try_sample_gpu_usage() {
        Ok(snapshot) => snapshot,
        Err(e) => GpuUsageSnapshot {
            available: false,
            gpu_percent: None,
            memory_percent: None,
            error: Some(format!("{e}")),
        },
    }
}
