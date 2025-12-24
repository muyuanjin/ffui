#[cfg(test)]
mod tools_tests_runtime_clear_error {
    use std::sync::Mutex;

    use once_cell::sync::Lazy;

    use crate::ffui_core::tools::ExternalToolKind;
    use crate::ffui_core::tools::runtime_state::{
        clear_tool_runtime_error, snapshot_download_state,
    };

    static TEST_MUTEX: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

    #[test]
    fn clear_tool_runtime_error_resets_arch_incompatible_flags_and_message() {
        let _guard = TEST_MUTEX.lock().unwrap();

        // 确保起始状态干净，避免其他测试遗留的错误信息影响断言。
        clear_tool_runtime_error(ExternalToolKind::Avifenc);

        // 先模拟一次架构不兼容错误，确保 runtime state 中写入了错误信息与标记。
        super::super::runtime_state::mark_arch_incompatible_for_session(
            ExternalToolKind::Avifenc,
            "path",
            "C:/Windows/Prefetch/AVIFENC.EXE-BA34AC6F.pf",
            &std::io::Error::from_raw_os_error(193),
        );

        let state_before = snapshot_download_state(ExternalToolKind::Avifenc);
        assert!(
            state_before.last_error.is_some(),
            "mark_arch_incompatible_for_session must record a last_error message",
        );
        assert!(
            state_before.path_arch_incompatible,
            "path_arch_incompatible flag should be set for PATH source",
        );

        // 调用清理函数后，错误信息和架构不兼容标记都应被重置。
        clear_tool_runtime_error(ExternalToolKind::Avifenc);
        let state_after = snapshot_download_state(ExternalToolKind::Avifenc);

        assert!(
            state_after.last_error.is_none(),
            "clear_tool_runtime_error must clear last_error so the UI does not show stale messages",
        );
        assert!(
            !state_after.download_arch_incompatible && !state_after.path_arch_incompatible,
            "clear_tool_runtime_error must clear both download_arch_incompatible and path_arch_incompatible flags",
        );
    }
}
