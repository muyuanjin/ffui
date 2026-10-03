use super::*;
use std::time::Instant;

#[test]
fn preview_workspace_child_holds_its_lease_until_terminated() {
    let Some(root) = std::env::var_os("FFUI_PREVIEW_WORKSPACE_TEST_ROOT") else {
        return;
    };
    let root = PathBuf::from(root);
    let temporary = TemporaryPreview::new(&root.join("frames")).expect("workspace");
    (&mut temporary.as_file())
        .write_all(b"partial media")
        .expect("write partial");
    fs::write(
        root.join("ready"),
        temporary.path().to_string_lossy().as_bytes(),
    )
    .expect("ready");
    loop {
        std::thread::sleep(Duration::from_millis(100));
    }
}

#[test]
fn killed_preview_owner_is_reclaimed_without_touching_live_or_unmanaged_files() {
    let root = tempfile::tempdir().expect("root");
    let frames = root.path().join("frames");
    fs::create_dir(&frames).expect("frames");
    let unmanaged = frames.join("user.part");
    fs::write(&unmanaged, b"keep").expect("unmanaged file");
    let unrelated = frames.join(".ffui-preview-unmanaged");
    fs::create_dir(&unrelated).expect("unrelated directory");
    fs::write(unrelated.join("lease"), b"not an owned preview").expect("unrelated marker");
    let live = TemporaryPreview::new(&frames).expect("live workspace");
    let mut child = super::super::PreviewChild(std::process::Command::new(std::env::current_exe().expect("test binary"))
        .args(["--exact", "ffui_core::media_preview::cache::tests::preview_workspace_child_holds_its_lease_until_terminated", "--test-threads=1"])
        .env("FFUI_PREVIEW_WORKSPACE_TEST_ROOT", root.path())
        .stdout(std::process::Stdio::null()).spawn().expect("child"));
    let started = Instant::now();
    while !root.path().join("ready").exists() {
        assert!(
            started.elapsed() < Duration::from_secs(20),
            "child never acquired lease"
        );
        assert!(child.0.try_wait().expect("status").is_none());
        std::thread::sleep(Duration::from_millis(10));
    }
    let partial =
        PathBuf::from(fs::read_to_string(root.path().join("ready")).expect("partial path"));
    reclaim(root.path(), None, 0).expect("clear while active");
    assert!(partial.exists());
    assert!(live.path().exists());
    child.0.kill().expect("terminate without destructors");
    child.0.wait().expect("terminated");
    reclaim(root.path(), None, 0).expect("recover abandoned workspace");
    assert!(!partial.parent().expect("workspace").exists());
    assert!(live.path().exists());
    assert_eq!(fs::read(&unmanaged).expect("unmanaged"), b"keep");
    assert!(unrelated.exists());
    drop(live);
    assert_eq!(fs::read_dir(&frames).expect("remaining files").count(), 2);
}

#[test]
fn workspace_with_unmanaged_contents_is_not_reclaimed() {
    let root = tempfile::tempdir().expect("root");
    let frames = root.path().join("frames");
    fs::create_dir(&frames).expect("frames");
    let temporary = TemporaryPreview::new(&frames).expect("workspace");
    let TemporaryPreview {
        file,
        lease,
        directory,
    } = temporary;
    drop(file);
    drop(lease);
    let path = directory.keep();
    fs::write(path.join("user.txt"), b"keep").expect("unmanaged content");
    reclaim(root.path(), None, 0).expect("clear cache");
    assert!(path.join("output.part").exists());
    assert_eq!(
        fs::read(path.join("user.txt")).expect("unmanaged content"),
        b"keep"
    );
}
