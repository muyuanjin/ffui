use super::types::AppSettings;

impl AppSettings {
    pub fn effective_resume_backtrack_seconds(&self) -> f64 {
        const DEFAULT_BACKTRACK_SECONDS: f64 = 2.0;
        const MAX_BACKTRACK_SECONDS: f64 = 30.0;
        self.resume_backtrack_seconds
            // Allow explicit 0 to disable overlap trimming for debugging or
            // performance-sensitive workflows.
            .filter(|v| v.is_finite() && *v >= 0.0)
            .map(|v| v.clamp(0.0, MAX_BACKTRACK_SECONDS))
            .unwrap_or(DEFAULT_BACKTRACK_SECONDS)
    }
}
