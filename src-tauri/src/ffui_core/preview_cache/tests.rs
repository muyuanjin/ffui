use super::*;
use std::collections::HashSet;
use std::fs;

#[test]
fn cleanup_unreferenced_previews_deletes_only_unreferenced_images() {
    let dir = tempfile::tempdir().expect("tempdir");
    let previews = dir.path().join("previews");
    fs::create_dir_all(&previews).expect("create previews root");

    let keep = previews.join("keep.jpg");
    let delete = previews.join("delete.jpg");
    let other = previews.join("note.txt");
    fs::write(&keep, b"keep").unwrap();
    fs::write(&delete, b"delete").unwrap();
    fs::write(&other, b"note").unwrap();

    fs::create_dir_all(previews.join("fallback-cache").join("frames")).unwrap();

    let referenced = HashSet::from(["keep.jpg".to_string()]);
    let deleted = cleanup_unreferenced_previews(&previews, &referenced).unwrap();
    assert_eq!(deleted, 1);
    assert!(keep.exists());
    assert!(!delete.exists());
    assert!(other.exists());
}
