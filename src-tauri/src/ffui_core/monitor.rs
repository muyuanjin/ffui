use std::sync::{Arc, Mutex, OnceLock};

use anyhow::Result;
use nvml_wrapper::Nvml;
use nvml_wrapper::error::NvmlError;
use serde::{Deserialize, Serialize};
use sysinfo::System;

use crate::sync_ext::MutexExt;

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
    /// Best-effort device model name (e.g. "NVIDIA GeForce RTX 2070").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    pub gpu_percent: Option<u32>,
    pub memory_percent: Option<u32>,
    pub error: Option<String>,
}

pub fn sample_cpu_usage() -> CpuUsageSnapshot {
    // Reuse a single System instance across calls so that sysinfo's internal
    // baselines are warmed once instead of paying the initialization cost on
    // every IPC round-trip.
    static SYSTEM: OnceLock<Mutex<System>> = OnceLock::new();

    let per_core: Vec<f32> = {
        let mut sys = SYSTEM
            .get_or_init(|| {
                let mut sys = System::new();
                sys.refresh_cpu_usage();
                Mutex::new(sys)
            })
            .lock_unpoisoned();
        sys.refresh_cpu_usage();
        sys.cpus().iter().map(sysinfo::Cpu::cpu_usage).collect()
    };
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
    static NVML_INSTANCE: OnceLock<Mutex<Option<Arc<Nvml>>>> = OnceLock::new();

    let nvml: Arc<Nvml> = {
        let mutex = NVML_INSTANCE.get_or_init(|| Mutex::new(None));
        let mut guard = mutex.lock_unpoisoned();
        if guard.is_none() {
            *guard = Some(Arc::new(Nvml::init()?));
        }
        guard.as_ref().cloned().ok_or(NvmlError::Unknown)?
    };
    let device_count = nvml.device_count()?;
    if device_count == 0 {
        return Ok(GpuUsageSnapshot {
            available: false,
            model: None,
            gpu_percent: None,
            memory_percent: None,
            error: Some("No NVIDIA GPUs detected".to_string()),
        });
    }

    let device = nvml.device_by_index(0)?;
    let model = device.name().ok();
    let util = device.utilization_rates()?;
    let memory = device.memory_info()?;
    let memory_percent = if memory.total > 0 {
        let used = u128::from(memory.used);
        let total = u128::from(memory.total);
        let percent = (used.saturating_mul(100).saturating_add(total / 2)) / total;
        u32::try_from(percent).ok()
    } else {
        None
    };

    Ok(GpuUsageSnapshot {
        available: true,
        model,
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
            model: None,
            gpu_percent: None,
            memory_percent: None,
            error: Some(format!("{e}")),
        },
    }
}
