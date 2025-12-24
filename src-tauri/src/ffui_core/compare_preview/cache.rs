use std::path::Path;

use crate::ffui_core::preview_common::maybe_cleanup_compare_cache_now;

pub(super) fn maybe_cleanup_cache_now(cache_root: &Path) {
    maybe_cleanup_compare_cache_now(cache_root);
}
