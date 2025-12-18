use std::path::Path;

use super::*;

#[test]
fn derive_instance_key_is_deterministic_and_distinct() {
    let a1 = derive_instance_key(Path::new("/tmp/a"));
    let a2 = derive_instance_key(Path::new("/tmp/a"));
    let b = derive_instance_key(Path::new("/tmp/b"));

    assert_eq!(a1, a2);
    assert_ne!(a1, b);
}

#[cfg(not(windows))]
mod non_windows {
    use std::fs::OpenOptions;
    use std::time::Duration;

    use fs2::FileExt;

    use super::*;

    #[test]
    fn lock_contention_blocks_second_handle() {
        let dir = tempfile::tempdir().expect("tempdir must be created");
        let lock_path = dir.path().join("ffui_test.lock");

        let file1 = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&lock_path)
            .expect("open lock file 1");
        file1.try_lock_exclusive().expect("first lock must succeed");

        let file2 = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&lock_path)
            .expect("open lock file 2");
        file2
            .try_lock_exclusive()
            .expect_err("second lock must fail while first lock is held");

        drop(file1);
        file2
            .try_lock_exclusive()
            .expect("lock must succeed after release");
    }

    #[test]
    fn focus_udp_signal_is_received_by_loopback_socket() {
        let server = FocusServer::bind_loopback().expect("bind loopback focus server");
        let port = server.port().expect("read focus server port");

        server
            .socket
            .set_read_timeout(Some(Duration::from_secs(1)))
            .expect("set read timeout");

        send_focus_signal(port).expect("send focus signal");

        let mut buffer = [0u8; 64];
        let (len, from) = server
            .socket
            .recv_from(&mut buffer)
            .expect("focus server must receive datagram");

        assert_eq!(&buffer[..len], FOCUS_MESSAGE);
        assert_eq!(from.ip().to_string(), LOOPBACK_ADDR);
    }

    #[test]
    fn lock_info_round_trip_is_readable() {
        let dir = tempfile::tempdir().expect("tempdir must be created");
        let lock_path = dir.path().join("ffui_test_info.lock");
        let mut lock_file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&lock_path)
            .expect("open lock file");

        write_lock_info(&mut lock_file, LockInfo { port: 4242, pid: 7 }).expect("write lock info");

        let info = read_lock_info_with_retries(&lock_path).expect("read lock info");
        assert_eq!(info.port, 4242);
        assert_eq!(info.pid, 7);
    }
}
