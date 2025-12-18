use std::collections::hash_map::DefaultHasher;
use std::hash::{
    Hash,
    Hasher,
};
use std::sync::atomic::Ordering;

pub(super) fn random_hex(len: usize) -> String {
    if len == 0 {
        return String::new();
    }

    let mut out = String::with_capacity(len);
    while out.len() < len {
        let counter = super::RANDOM_COUNTER.fetch_add(1, Ordering::Relaxed);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let mut hasher = DefaultHasher::new();
        now.hash(&mut hasher);
        counter.hash(&mut hasher);
        let v = hasher.finish();
        out.push_str(&format!("{v:016x}"));
    }

    out.truncate(len);
    out
}

pub(super) fn normalize_extension_no_dot(raw: &str) -> String {
    raw.trim().trim_start_matches('.').to_ascii_lowercase()
}
