pub fn open_source_fonts_catalog() -> Vec<(String, String, String, String, String)> {
    // (id, display name, family name, format, url)
    vec![
        (
            "inter".to_string(),
            "Inter (Open source)".to_string(),
            "Inter".to_string(),
            "ttf".to_string(),
            "https://raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter%5Bopsz,wght%5D.ttf"
                .to_string(),
        ),
        (
            "jetbrains-mono".to_string(),
            "JetBrains Mono (Open source)".to_string(),
            "JetBrains Mono".to_string(),
            "ttf".to_string(),
            "https://raw.githubusercontent.com/JetBrains/JetBrainsMono/master/fonts/ttf/JetBrainsMono-Regular.ttf"
                .to_string(),
        ),
        (
            "noto-sans-sc".to_string(),
            "Noto Sans SC (Open source)".to_string(),
            "Noto Sans SC".to_string(),
            "ttf".to_string(),
            "https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf"
                .to_string(),
        ),
    ]
}

pub fn proxy_from_env() -> Option<String> {
    for key in ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"] {
        if let Ok(v) = std::env::var(key) {
            let trimmed = v.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}
