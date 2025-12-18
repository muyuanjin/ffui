const media = {
  clearCurrent: "Clear current media",
  inspectError:
    "Failed to inspect media file. ffprobe may be unavailable, the path may be invalid, or the file format is not supported. Please verify ffprobe configuration in Software Settings and ensure the file still exists.",
  chooseFile: "Choose media file…",
  inspecting: "Inspecting…",
  emptyTitle: "Drop or choose a video/image file",
  emptyDescription: "Only one media file is shown at a time. Dropping a new file replaces the previous one.",
  typeVideo: "Video",
  typeImage: "Image",
  dropTitle: "Drop media file onto the window",
  dropSubtitle: "Release to inspect this media file only in the Media Info panel",
  sections: {
    preview: "Preview",
    summary: "Summary",
    format: "Format & container",
    streams: "Streams",
    raw: "Raw ffprobe JSON",
  },
  copyRawJson: "Copy raw JSON",
  fields: {
    filePath: {
      label: "File path",
      tooltip: "Absolute filesystem path of the media file.",
    },
    fileName: {
      label: "File name",
      tooltip: "Media file name without directory.",
    },
    fileType: {
      label: "Type",
      tooltip: "Rough classification as video or image based on extension.",
    },
    fileSize: {
      label: "File size",
      tooltip: "Actual size from the filesystem. Displayed with automatic KB/MB/GB units.",
    },
    createdAt: {
      label: "Created at",
      tooltip: "Creation time of the file on this filesystem (if the platform exposes it).",
    },
    modifiedAt: {
      label: "Modified at",
      tooltip: "Last time the file content was written.",
    },
    accessedAt: {
      label: "Accessed at",
      tooltip: "Last time the file was accessed. Some platforms may not maintain this timestamp.",
    },
    duration: {
      label: "Duration",
      tooltip: "Total media duration reported by ffprobe, formatted as hours:minutes:seconds.",
    },
    resolution: {
      label: "Resolution",
      tooltip: "Video frame width and height in pixels, e.g. 1920x1080.",
    },
    frameRate: {
      label: "Frame rate",
      tooltip: "Average frames per second (FPS) reported by ffprobe for the main video stream.",
    },
    videoCodec: {
      label: "Video codec",
      tooltip: "Codec used by the primary video stream (e.g. h264, hevc, av1).",
    },
    audioCodec: {
      label: "Audio codec",
      tooltip: "Codec used by the primary audio stream (e.g. aac, opus). Empty if there is no audio.",
    },
    formatName: {
      label: "Container format",
      tooltip: "Short container identifier reported by ffprobe, e.g. mov,mp4,m4a,3gp.",
    },
    formatLongName: {
      label: "Container description",
      tooltip: "Human-readable container description, e.g. QuickTime / MOV / MP4.",
    },
    bitRate: {
      label: "Overall bitrate",
      tooltip: "Average container-level bitrate in kilobits per second (kbps).",
    },
    tags: {
      label: "Format tags",
      tooltip: "Metadata tags attached at the container level, such as title or artist.",
    },
    streamCodec: {
      label: "Stream codec",
      tooltip: "Codec name and optional long name for this individual stream (video, audio, subtitle, etc.).",
    },
    streamResolution: {
      label: "Stream resolution",
      tooltip: "Resolution of this video stream. Only available for video streams.",
    },
    streamFrameRate: {
      label: "Stream frame rate",
      tooltip: "Frame rate of this video stream. Only available when ffprobe exposes it.",
    },
    streamSampleRate: {
      label: "Sample rate",
      tooltip: "Audio sample rate of this stream in hertz (Hz). Only applies to audio streams.",
    },
    streamChannels: {
      label: "Channels",
      tooltip: "Number of audio channels (e.g. 2 for stereo, 6 for 5.1).",
    },
    streamLayout: {
      label: "Channel layout",
      tooltip: "Channel layout description for the audio stream, such as stereo or 5.1.",
    },
    streamBitRate: {
      label: "Stream bitrate",
      tooltip: "Average bitrate for this individual stream in kilobits per second (kbps).",
    },
    streamTags: {
      label: "Stream tags",
      tooltip: "Metadata tags attached to this specific stream, such as language or title.",
    },
  },
  noStreams: "ffprobe did not report any streams for this media.",
} as const;

export default media;
