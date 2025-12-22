use std::path::PathBuf;

use super::*;

#[test]
fn build_concat_demuxer_list_contents_writes_duration_and_outpoint() {
    let segments = vec![
        PathBuf::from("C:/tmp/seg0.mkv"),
        PathBuf::from("C:/tmp/seg1.mkv"),
    ];
    let content = build_concat_demuxer_list_contents(&segments, Some(&[1.234_567]))
        .expect("build concat list");
    assert!(
        content.contains("file 'C:/tmp/seg0.mkv'\n"),
        "expected first file entry, got:\n{content}"
    );
    assert!(
        content.contains("duration 1.234567\noutpoint 1.234567\n"),
        "expected duration/outpoint entry, got:\n{content}"
    );
    assert!(
        content.contains("file 'C:/tmp/seg1.mkv'\n"),
        "expected second file entry, got:\n{content}"
    );
}

#[test]
fn build_concat_demuxer_list_contents_escapes_single_quotes() {
    let segments = vec![PathBuf::from("C:/tmp/a'b.mkv")];
    let content = build_concat_demuxer_list_contents(&segments, None).expect("build concat list");
    assert!(
        content.contains("file 'C:/tmp/a'\\''b.mkv'\n"),
        "expected escaped single quote, got:\n{content}"
    );
}
