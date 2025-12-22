# Mock ffmpeg (test-only)

This repository includes a small native mock executable used by backend tests to validate argv fidelity when spawning ffmpeg-like processes.

## Environment variables

- `FFUI_MOCK_FFMPEG_CAPTURE_PATH`: when set, the mock writes a JSON capture file to this path.
- `FFUI_MOCK_FFMPEG_EMIT_PROGRESS`: when `1`/`true`, the mock emits minimal `-progress pipe:2`-like lines to stderr.
- `FFUI_MOCK_FFMPEG_EXIT_CODE`: integer exit code (default `0`).

## Capture JSON format

```json
{
  "argv": ["-i", "input.mp4", "output.mp4"]
}
```
