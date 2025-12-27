use std::time::Duration;

use tauri::{Manager, PhysicalPosition, PhysicalSize, Position};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct RectI32 {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

impl RectI32 {
    fn contains_point(self, x: i32, y: i32) -> bool {
        x >= self.x
            && y >= self.y
            && x < self.x.saturating_add(self.width)
            && y < self.y.saturating_add(self.height)
    }
}

#[derive(Debug, Clone, Copy)]
struct MonitorRect {
    rect: RectI32,
    is_primary: bool,
}

const TITLEBAR_ANCHOR_Y_PX: i32 = 16;
const DEFAULT_TOP_MARGIN_PX: i32 = 32;

fn clamp_i32(value: i32, min: i32, max: i32) -> i32 {
    if value < min {
        min
    } else if value > max {
        max
    } else {
        value
    }
}

fn compute_titlebar_anchor(
    window_pos: PhysicalPosition<i32>,
    window_size: PhysicalSize<u32>,
) -> (i32, i32) {
    let width_i32 = i32::try_from(window_size.width).unwrap_or(i32::MAX);
    let anchor_dx = if width_i32 <= 0 { 0 } else { width_i32 / 2 };
    (
        window_pos.x.saturating_add(anchor_dx),
        window_pos.y.saturating_add(TITLEBAR_ANCHOR_Y_PX),
    )
}

fn compute_recovery_position(
    window_pos: PhysicalPosition<i32>,
    window_size: PhysicalSize<u32>,
    monitors: &[MonitorRect],
) -> Option<PhysicalPosition<i32>> {
    if monitors.is_empty() {
        return None;
    }

    let (anchor_x, anchor_y) = compute_titlebar_anchor(window_pos, window_size);
    if monitors
        .iter()
        .any(|monitor| monitor.rect.contains_point(anchor_x, anchor_y))
    {
        return None;
    }

    let target = monitors
        .iter()
        .find(|monitor| monitor.is_primary)
        .unwrap_or(&monitors[0])
        .rect;

    let win_w = i32::try_from(window_size.width).unwrap_or(i32::MAX);
    let win_h = i32::try_from(window_size.height).unwrap_or(i32::MAX);

    let max_x = if win_w >= target.width {
        target.x
    } else {
        target.x.saturating_add(target.width.saturating_sub(win_w))
    };
    let max_y = if win_h >= target.height {
        target.y
    } else {
        target.y.saturating_add(target.height.saturating_sub(win_h))
    };

    let desired_x = target
        .x
        .saturating_add(target.width.saturating_sub(win_w) / 2);
    let desired_y = target.y.saturating_add(DEFAULT_TOP_MARGIN_PX);

    Some(PhysicalPosition::new(
        clamp_i32(desired_x, target.x, max_x),
        clamp_i32(desired_y, target.y, max_y),
    ))
}

fn ensure_window_is_on_screen(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    let window_pos = window.outer_position()?;
    let window_size = window.outer_size()?;

    let primary_monitor = window.primary_monitor().ok().flatten();
    let monitors = window
        .available_monitors()?
        .into_iter()
        .map(|monitor| {
            let pos = monitor.position();
            let size = monitor.size();
            let rect = RectI32 {
                x: pos.x,
                y: pos.y,
                width: i32::try_from(size.width).unwrap_or(i32::MAX),
                height: i32::try_from(size.height).unwrap_or(i32::MAX),
            };
            let is_primary = primary_monitor.as_ref().is_some_and(|primary| {
                primary.position() == monitor.position() && primary.size() == monitor.size()
            });
            MonitorRect { rect, is_primary }
        })
        .collect::<Vec<_>>();

    let Some(new_pos) = compute_recovery_position(window_pos, window_size, &monitors) else {
        return Ok(());
    };

    if new_pos == window_pos {
        return Ok(());
    }

    crate::debug_eprintln!(
        "main window appears offscreen at ({}, {}), moving to ({}, {})",
        window_pos.x,
        window_pos.y,
        new_pos.x,
        new_pos.y
    );

    window.set_position(Position::Physical(new_pos))?;
    Ok(())
}

pub fn recover_main_window_if_offscreen(handle: &tauri::AppHandle) {
    let Some(window) = handle.get_webview_window("main") else {
        return;
    };

    if let Err(err) = ensure_window_is_on_screen(&window) {
        crate::debug_eprintln!("failed to recover main window position: {err}");
    }
}

pub fn spawn_main_window_offscreen_recovery(handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        std::thread::park_timeout(Duration::from_millis(200));
        recover_main_window_if_offscreen(&handle);
        std::thread::park_timeout(Duration::from_millis(800));
        recover_main_window_if_offscreen(&handle);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn monitor(x: i32, y: i32, w: i32, h: i32, is_primary: bool) -> MonitorRect {
        MonitorRect {
            rect: RectI32 {
                x,
                y,
                width: w,
                height: h,
            },
            is_primary,
        }
    }

    #[test]
    fn compute_recovery_position_returns_none_when_titlebar_anchor_is_visible() {
        let window_pos = PhysicalPosition::new(100, 100);
        let window_size = PhysicalSize::new(800, 600);
        let monitors = vec![monitor(0, 0, 1920, 1080, true)];

        let recovered = compute_recovery_position(window_pos, window_size, &monitors);
        assert!(recovered.is_none());
    }

    #[test]
    fn compute_recovery_position_moves_to_primary_monitor_when_offscreen() {
        let window_pos = PhysicalPosition::new(-10_000, -10_000);
        let window_size = PhysicalSize::new(800, 600);
        let monitors = vec![monitor(0, 0, 1920, 1080, true)];

        let recovered = compute_recovery_position(window_pos, window_size, &monitors)
            .expect("offscreen window should be recovered");

        assert!(
            monitors[0]
                .rect
                .contains_point(recovered.x + 400, recovered.y + TITLEBAR_ANCHOR_Y_PX),
            "recovered titlebar anchor should be visible"
        );
    }

    #[test]
    fn compute_recovery_position_prefers_primary_in_multi_monitor_layout() {
        let window_pos = PhysicalPosition::new(10_000, 10_000);
        let window_size = PhysicalSize::new(800, 600);
        let monitors = vec![
            monitor(-1920, 0, 1920, 1080, false),
            monitor(0, 0, 1920, 1080, true),
        ];

        let recovered = compute_recovery_position(window_pos, window_size, &monitors)
            .expect("offscreen window should be recovered");

        assert!(
            monitors[1]
                .rect
                .contains_point(recovered.x + 400, recovered.y + TITLEBAR_ANCHOR_Y_PX),
            "recovered window should land on primary monitor"
        );
    }

    #[test]
    fn compute_recovery_position_clamps_when_window_is_larger_than_monitor() {
        let window_pos = PhysicalPosition::new(-5000, -5000);
        let window_size = PhysicalSize::new(5000, 4000);
        let monitors = vec![monitor(0, 0, 1920, 1080, true)];

        let recovered = compute_recovery_position(window_pos, window_size, &monitors)
            .expect("offscreen window should be recovered");

        assert_eq!(recovered, PhysicalPosition::new(0, 0));
    }
}
