fn input_file_times_for_policy(
    policy: &crate::ffui_core::domain::PreserveFileTimesPolicy,
    input_path: &Path,
) -> Option<super::file_times::FileTimesSnapshot> {
    if !policy.any() {
        return None;
    }

    let mut times = super::file_times::read_file_times(input_path);
    if !policy.created() {
        times.created = None;
    }
    if !policy.modified() {
        times.modified = None;
    }
    if !policy.accessed() {
        times.accessed = None;
    }
    Some(times)
}
