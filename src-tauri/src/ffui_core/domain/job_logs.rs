use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct JobLogLine {
    pub text: String,
    pub at_ms: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
enum JobLogLineCompat {
    Text(String),
    Entry(JobLogLine),
}

pub(crate) fn deserialize_job_log_lines<'de, D>(
    deserializer: D,
) -> Result<Vec<JobLogLine>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = Vec::<JobLogLineCompat>::deserialize(deserializer)?;
    Ok(raw
        .into_iter()
        .map(|v| match v {
            JobLogLineCompat::Text(text) => JobLogLine { text, at_ms: None },
            JobLogLineCompat::Entry(entry) => entry,
        })
        .collect())
}
