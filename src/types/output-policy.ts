export type OutputContainerPolicy =
  | { mode: "default" }
  | { mode: "keepInput" }
  | { mode: "force"; format: string };

export type OutputDirectoryPolicy =
  | { mode: "sameAsInput" }
  | { mode: "fixed"; directory: string };

export interface OutputFilenameRegexReplace {
  pattern: string;
  replacement: string;
}

export interface OutputFilenamePolicy {
  /** Optional string prepended to the filename stem. */
  prefix?: string;
  /** Optional string appended to the filename stem. Defaults to ".compressed". */
  suffix?: string;
  /** Optional regex replace applied to the stem (Rust regex syntax). */
  regexReplace?: OutputFilenameRegexReplace;
  /** When true, append a local timestamp suffix `YYYYMMDD-HHmmss`. */
  appendTimestamp?: boolean;
  /** When true, append an encoder+quality tag when it can be inferred. */
  appendEncoderQuality?: boolean;
  /** Optional fixed length of random hex characters appended to the stem. */
  randomSuffixLen?: number;
}

export interface OutputPolicy {
  container: OutputContainerPolicy;
  directory: OutputDirectoryPolicy;
  filename: OutputFilenamePolicy;
  /** When true, try to preserve creation/modified/access times from input. */
  preserveFileTimes?: boolean;
}

export const DEFAULT_OUTPUT_POLICY: OutputPolicy = {
  container: { mode: "default" },
  directory: { mode: "sameAsInput" },
  filename: {
    suffix: ".compressed",
    appendTimestamp: false,
    appendEncoderQuality: false,
    randomSuffixLen: undefined,
    prefix: undefined,
    regexReplace: undefined,
  },
  preserveFileTimes: false,
};

