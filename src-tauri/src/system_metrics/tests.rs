use std::time::Instant;

use serde_json::Value;

use super::*;

#[test]
fn metrics_sampler_does_not_init_sysinfo_while_unsubscribed() {
    let mut sys: Option<System> = None;
    let mut networks: Option<Networks> = None;
    let mut last_instant: Option<Instant> = None;

    let did_init = seed_sysinfo_if_needed(0, &mut sys, &mut networks, &mut last_instant);
    assert!(!did_init, "must not initialize sysinfo when unsubscribed");
    assert!(sys.is_none(), "sysinfo System must remain uninitialized");
    assert!(
        networks.is_none(),
        "sysinfo Networks must remain uninitialized"
    );
    assert!(last_instant.is_none(), "last_instant must remain unset");
}

#[test]
fn ring_buffer_is_bounded() {
    let config = MetricsConfig {
        history_capacity: 3,
        ..MetricsConfig::default()
    };
    let state = MetricsState::new(config);

    for i in 0..10 {
        state.push_snapshot(MetricsSnapshot {
            timestamp: i,
            uptime_seconds: 0,
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
            gpu: None,
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
fn settings_override_sampling_interval_and_clamp_floor() {
    // A reasonable override should be applied as-is.
    let mut config_reasonable = MetricsConfig {
        sampling_interval: Duration::from_millis(1_000),
        ..MetricsConfig::default()
    };
    let settings_reasonable = AppSettings {
        metrics_interval_ms: Some(500),
        ..AppSettings::default()
    };
    apply_settings_overrides(&mut config_reasonable, &settings_reasonable);
    assert_eq!(
        config_reasonable.sampling_interval,
        Duration::from_millis(500),
        "metrics_interval_ms should override default sampling interval"
    );

    // Extremely small intervals should be clamped to avoid busy-looping.
    let mut config_small = MetricsConfig {
        sampling_interval: Duration::from_millis(1_000),
        ..MetricsConfig::default()
    };
    let settings_small = AppSettings {
        metrics_interval_ms: Some(10),
        ..AppSettings::default()
    };
    apply_settings_overrides(&mut config_small, &settings_small);
    assert_eq!(
        config_small.sampling_interval,
        Duration::from_millis(100),
        "metrics_interval_ms must be clamped to a sensible minimum"
    );
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
        timestamp: 1_710_000_000_000,
        uptime_seconds: 1234,
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
        gpu: Some(GpuUsageSnapshot {
            available: true,
            model: Some("NVIDIA GeForce RTX 2070".to_string()),
            gpu_percent: Some(42),
            memory_percent: Some(55),
            error: None,
        }),
    };

    let value: Value =
        serde_json::to_value(&snapshot).expect("metrics snapshot should serialize to JSON");

    assert!(value.get("timestamp").is_some(), "timestamp field missing");
    assert!(
        value.get("uptimeSeconds").is_some(),
        "uptimeSeconds field missing"
    );
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

    // GPU metrics should be present under the `gpu` key with the same
    // contract as the legacy get_gpu_usage command.
    assert!(
        value["gpu"]["available"].is_boolean(),
        "gpu.available must be a boolean"
    );
    assert!(
        value["gpu"]["gpuPercent"].is_number(),
        "gpu.gpuPercent must be a number when available"
    );
    assert!(
        value["gpu"]["memoryPercent"].is_number(),
        "gpu.memoryPercent must be a number when available"
    );
    assert!(
        value["gpu"]["model"].is_string(),
        "gpu.model must be string when present"
    );
}

#[test]
fn sampling_mode_respects_subscriber_count() {
    let config = MetricsConfig::default();

    assert_eq!(
        sampling_mode(0, &config),
        SamplingMode::Idle(config.idle_interval)
    );
    assert_eq!(
        sampling_mode(1, &config),
        SamplingMode::Active(config.sampling_interval)
    );
}

#[test]
fn subscribe_wakes_waiters() {
    let state = MetricsState::default();
    let state_for_waiter = state.clone();

    let started = Instant::now();
    let handle = std::thread::spawn(move || {
        // Use a long timeout and rely on subscribe() to wake the waiter quickly.
        state_for_waiter.wait_for_wakeup_or_timeout(Duration::from_secs(5));
        started.elapsed()
    });

    std::thread::sleep(Duration::from_millis(30));
    state.subscribe();

    let elapsed = handle.join().expect("waiter thread join must succeed");
    assert!(
        elapsed < Duration::from_secs(1),
        "waiter should be woken quickly by subscribe(), elapsed={elapsed:?}"
    );
}
