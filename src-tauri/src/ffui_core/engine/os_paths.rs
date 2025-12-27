pub(super) fn normalize_os_path_string(raw: &str) -> String {
    #[cfg(windows)]
    {
        raw.replace('/', "\\")
    }
    #[cfg(not(windows))]
    {
        raw.to_string()
    }
}
