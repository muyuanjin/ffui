use once_cell::sync::Lazy;

use std::sync::Mutex;

pub(super) static ENGINE_TEST_MUTEX: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));
