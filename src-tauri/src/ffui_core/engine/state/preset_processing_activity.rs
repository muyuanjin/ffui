use std::sync::Arc;

use super::EngineState;

#[derive(Debug, Clone)]
pub(crate) struct PresetProcessingActivity {
    pub(crate) active_processing_jobs: u32,
    pub(crate) active_since_ms: Option<u64>,
}

impl EngineState {
    pub(crate) fn note_preset_processing_started(&mut self, preset_id: &str, now_ms: u64) {
        let entry = self
            .preset_processing_activity
            .entry(preset_id.to_string())
            .or_insert(PresetProcessingActivity {
                active_processing_jobs: 0,
                active_since_ms: None,
            });
        if entry.active_processing_jobs == 0 {
            entry.active_since_ms = Some(now_ms);
        }
        entry.active_processing_jobs = entry.active_processing_jobs.saturating_add(1);
    }

    pub(crate) fn note_preset_processing_stopped(&mut self, preset_id: &str, now_ms: u64) -> bool {
        let Some(entry) = self.preset_processing_activity.get_mut(preset_id) else {
            return false;
        };
        if entry.active_processing_jobs == 0 {
            return false;
        }

        let mut did_update_time = false;
        if let Some(since_ms) = entry.active_since_ms
            && now_ms > since_ms
        {
            let delta_seconds = (now_ms - since_ms) as f64 / 1000.0;
            if delta_seconds.is_finite() && delta_seconds > 0.0 {
                let presets = Arc::make_mut(&mut self.presets);
                if let Some(preset) = presets.iter_mut().find(|p| p.id == preset_id) {
                    preset.stats.total_time_seconds += delta_seconds;
                    did_update_time = true;
                }
            }
        }

        entry.active_processing_jobs = entry.active_processing_jobs.saturating_sub(1);
        if entry.active_processing_jobs == 0 {
            entry.active_since_ms = None;
        } else {
            entry.active_since_ms = Some(now_ms);
        }

        did_update_time
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ffui_core::settings::AppSettings;

    #[test]
    fn preset_wall_time_is_union_of_overlapping_processing_jobs() {
        let mut state = EngineState::new(
            vec![crate::test_support::make_ffmpeg_preset_for_tests(
                "preset-1",
            )],
            AppSettings::default(),
        );

        // Job A starts at t=1000, job B starts at t=2000, A stops at t=5000, B stops at t=7000.
        // Union wall-clock = (7000 - 1000) ms = 6 seconds.
        state.note_preset_processing_started("preset-1", 1000);
        state.note_preset_processing_started("preset-1", 2000);

        state.note_preset_processing_stopped("preset-1", 5000);
        let after_first_stop = state.presets[0].stats.total_time_seconds;
        assert!(
            (after_first_stop - 4.0).abs() < 0.000_1,
            "expected 4s after first stop, got {after_first_stop}"
        );

        state.note_preset_processing_stopped("preset-1", 7000);
        let total = state.presets[0].stats.total_time_seconds;
        assert!(
            (total - 6.0).abs() < 0.000_1,
            "expected 6s union wall time, got {total}"
        );
    }
}
