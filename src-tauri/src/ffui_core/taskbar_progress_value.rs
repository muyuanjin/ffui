use super::{JobExecutionMode, JobStatus};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum TaskbarProgressValue {
    Empty,
    Indeterminate,
    Determinate(f64),
}

#[cfg(any(windows, test))]
impl TaskbarProgressValue {
    pub(crate) fn windows_percent(self) -> Option<u64> {
        let Self::Determinate(progress) = self else {
            return None;
        };
        let ceiling = if progress < 1.0 { 99.0 } else { 100.0 };
        Some((progress * 100.0).round().clamp(0.0, ceiling) as u64)
    }
}

pub fn is_indeterminate_job_progress(
    status: JobStatus,
    mode: Option<JobExecutionMode>,
    known_percent: Option<f64>,
) -> bool {
    status == JobStatus::Processing
        && (mode == Some(JobExecutionMode::Transparent)
            || (mode == Some(JobExecutionMode::Managed)
                && !known_percent.is_some_and(f64::is_finite)))
}
