fn main() {
    tauri_build::build();

    // Keep tests/dev builds fast: only apply these MSVC link-time size/ICF opts in release.
    let profile = std::env::var("PROFILE").unwrap_or_default();
    let target_env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();

    if profile == "release" && target_os == "windows" && target_env == "msvc" {
        println!("cargo:rustc-link-arg=/OPT:REF");
        println!("cargo:rustc-link-arg=/OPT:ICF");
        println!("cargo:rustc-link-arg=/INCREMENTAL:NO");
    }
}
