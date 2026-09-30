use super::{JobExecutionMode, JobStatus};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum TaskbarProgressValue {
    Empty,
    Indeterminate,
    Determinate(f64),
}

pub fn is_indeterminate_job_progress(status: JobStatus, mode: Option<JobExecutionMode>) -> bool {
    status == JobStatus::Processing
        && matches!(
            mode,
            Some(JobExecutionMode::Managed | JobExecutionMode::Transparent)
        )
}
