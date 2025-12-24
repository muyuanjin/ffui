use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::atomic::Ordering;

pub(super) fn random_hex(len: usize) -> String {
    if len == 0 {
        return String::new();
    }

    const HEX: &[u8; 16] = b"0123456789abcdef";

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
        for shift in (0..64).step_by(4).rev() {
            let nibble = ((v >> shift) & 0xF) as usize;
            out.push(HEX[nibble] as char);
        }
    }

    out.truncate(len);
    out
}

pub(super) fn normalize_extension_no_dot(raw: &str) -> String {
    raw.trim().trim_start_matches('.').to_ascii_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn random_hex_has_stable_length_and_hex_charset() {
        for len in [0usize, 1, 15, 16, 17, 64] {
            let v = random_hex(len);
            assert_eq!(v.len(), len);
            assert!(v.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f')));
        }
    }
}
