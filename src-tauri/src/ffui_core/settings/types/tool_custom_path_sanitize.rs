use super::ExternalToolSettings;

impl ExternalToolSettings {
    pub(super) fn sanitize_custom_paths_for_auto_managed_downloads(&mut self) {
        // Only sanitize when tools are in the fully auto-managed mode. When users
        // explicitly configure custom paths, the frontend switches to manual
        // mode, so this will not clobber user intent.
        if !self.auto_download || !self.auto_update {
            return;
        }

        let Ok(tools_dir) = crate::ffui_core::tools_dir() else {
            return;
        };
        self.sanitize_custom_paths_for_auto_managed_downloads_with_tools_dir(&tools_dir);
    }

    fn sanitize_custom_paths_for_auto_managed_downloads_with_tools_dir(
        &mut self,
        tools_dir: &std::path::Path,
    ) {
        let expected_ffmpeg = tools_dir.join(if cfg!(windows) {
            "ffmpeg.exe"
        } else {
            "ffmpeg"
        });
        let expected_ffprobe = tools_dir.join(if cfg!(windows) {
            "ffprobe.exe"
        } else {
            "ffprobe"
        });
        let expected_avifenc = tools_dir.join(if cfg!(windows) {
            "avifenc.exe"
        } else {
            "avifenc"
        });

        if let Some(current) = self.ffmpeg_path.as_deref()
            && paths_equivalent_for_settings(current, &expected_ffmpeg)
        {
            self.ffmpeg_path = None;
        }
        if let Some(current) = self.ffprobe_path.as_deref()
            && paths_equivalent_for_settings(current, &expected_ffprobe)
        {
            self.ffprobe_path = None;
        }
        if let Some(current) = self.avifenc_path.as_deref()
            && paths_equivalent_for_settings(current, &expected_avifenc)
        {
            self.avifenc_path = None;
        }
    }

    #[cfg(test)]
    pub(crate) fn sanitize_custom_paths_for_auto_managed_downloads_with_tools_dir_for_tests(
        &mut self,
        tools_dir: &std::path::Path,
    ) {
        if !self.auto_download || !self.auto_update {
            return;
        }
        self.sanitize_custom_paths_for_auto_managed_downloads_with_tools_dir(tools_dir);
    }
}

fn paths_equivalent_for_settings(input: &str, expected: &std::path::Path) -> bool {
    fn normalize(value: &str) -> String {
        let mut s = value.trim().replace('\\', "/");
        while s.ends_with('/') {
            s.pop();
        }
        if cfg!(windows) {
            s = s.to_ascii_lowercase();
        }
        s
    }

    normalize(input) == normalize(&expected.to_string_lossy())
}
