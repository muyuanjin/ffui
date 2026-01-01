import { parseFfmpegError, type ParsedFfmpegError } from "@/lib/ffmpegError";

export type ParsedVmafMeasureError = ParsedFfmpegError;

export const parseVmafMeasureError = parseFfmpegError;
