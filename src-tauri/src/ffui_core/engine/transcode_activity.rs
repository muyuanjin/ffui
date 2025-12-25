use chrono::{Datelike, Local, TimeZone, Timelike};

use super::state::Inner;
use super::worker_utils::current_time_millis;
use crate::ffui_core::settings::AppSettings;
use crate::ffui_core::settings::types::{MonitorSettings, TranscodeActivityDay};
use crate::ffui_core::{
    TranscodeActivityToday, emit_transcode_activity_today_if_possible, settings,
};
use crate::sync_ext::MutexExt;

const RETAIN_DAYS: usize = 7;

fn local_date_key_and_hour(now_ms: u64) -> Option<(String, u8)> {
    let now_ms = i64::try_from(now_ms).ok()?;
    let dt = Local.timestamp_millis_opt(now_ms).single()?;
    let date = format!("{:04}-{:02}-{:02}", dt.year(), dt.month(), dt.day());
    let hour = u8::try_from(dt.hour()).ok()?;
    if hour >= 24 {
        return None;
    }
    Some((date, hour))
}

fn active_hours_from_mask(mask: u32) -> Vec<bool> {
    (0..24).map(|hour| (mask & (1u32 << hour)) != 0).collect()
}

fn upsert_activity_day(
    days: &mut Vec<TranscodeActivityDay>,
    date: String,
    new_mask: u32,
    updated_at_ms: u64,
) {
    if let Some(existing) = days.iter_mut().find(|d| d.date == date) {
        existing.active_hours_mask = new_mask;
        existing.updated_at_ms = Some(updated_at_ms);
        return;
    }

    days.push(TranscodeActivityDay {
        date,
        active_hours_mask: new_mask,
        updated_at_ms: Some(updated_at_ms),
    });

    // Keep bounded retention by date key (YYYY-MM-DD lexical order matches chronological order).
    days.sort_by(|a, b| a.date.cmp(&b.date));
    if days.len() > RETAIN_DAYS {
        days.drain(0..(days.len() - RETAIN_DAYS));
    }
}

fn mask_for_date(settings: &AppSettings, date_key: &str) -> u32 {
    let Some(monitor) = settings.monitor.as_ref() else {
        return 0;
    };
    let Some(days) = monitor.transcode_activity_days.as_ref() else {
        return 0;
    };
    days.iter()
        .find(|d| d.date == date_key)
        .map_or(0, |d| d.active_hours_mask)
}

pub(super) fn snapshot_transcode_activity_today(
    settings: &AppSettings,
    now_ms: u64,
) -> TranscodeActivityToday {
    let date_key =
        local_date_key_and_hour(now_ms).map_or_else(|| "1970-01-01".to_string(), |(date, _)| date);
    let mask = mask_for_date(settings, &date_key);

    TranscodeActivityToday {
        date: date_key,
        active_hours: active_hours_from_mask(mask),
    }
}

pub(super) fn get_transcode_activity_today(inner: &Inner) -> TranscodeActivityToday {
    let now_ms = current_time_millis();
    let state = inner.state.lock_unpoisoned();
    snapshot_transcode_activity_today(&state.settings, now_ms)
}

pub(super) fn record_processing_activity(inner: &Inner) {
    let now_ms = current_time_millis();
    let Some((date_key, hour)) = local_date_key_and_hour(now_ms) else {
        return;
    };
    let bit = 1u32 << u32::from(hour);

    let (payload_to_emit, settings_to_persist) = {
        let mut state = inner.state.lock_unpoisoned();

        let monitor = state
            .settings
            .monitor
            .get_or_insert_with(MonitorSettings::default);
        let days = monitor.transcode_activity_days.get_or_insert_with(Vec::new);

        let current_mask = days
            .iter()
            .find(|d| d.date == date_key)
            .map_or(0, |d| d.active_hours_mask);
        let new_mask = current_mask | bit;
        if new_mask == current_mask {
            (None, None)
        } else {
            upsert_activity_day(days, date_key.clone(), new_mask, now_ms);

            let payload = TranscodeActivityToday {
                date: date_key,
                active_hours: active_hours_from_mask(new_mask),
            };
            (Some(payload), Some(state.settings.clone()))
        }
    };

    if let Some(settings_to_persist) = settings_to_persist
        && let Err(err) = settings::save_settings(&settings_to_persist)
    {
        crate::debug_eprintln!("failed to persist transcode activity buckets: {err:#}");
    }

    if let Some(payload) = payload_to_emit {
        emit_transcode_activity_today_if_possible(payload);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upsert_activity_day_bounded_retention() {
        let mut days: Vec<TranscodeActivityDay> = Vec::new();
        for i in 0..10 {
            let date = format!("2025-01-{:02}", i + 1);
            upsert_activity_day(&mut days, date, 1u32 << (i % 24), 123);
        }

        assert_eq!(days.len(), RETAIN_DAYS);
        assert_eq!(days.first().unwrap().date, "2025-01-04");
        assert_eq!(days.last().unwrap().date, "2025-01-10");
    }
}
