export type OutputContainerPolicy = { mode: "default" } | { mode: "keepInput" } | { mode: "force"; format: string };

export type OutputDirectoryPolicy = { mode: "sameAsInput" } | { mode: "fixed"; directory: string };

export interface OutputFilenameRegexReplace {
  pattern: string;
  replacement: string;
}

export type OutputFilenameAppend = "suffix" | "timestamp" | "encoderQuality" | "random";

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
  /** Controls the append order when multiple suffix-like options are enabled. */
  appendOrder?: OutputFilenameAppend[];
}

export type PreserveFileTimesPolicy = {
  created?: boolean;
  modified?: boolean;
  accessed?: boolean;
};

export type PreserveFileTimes = boolean | PreserveFileTimesPolicy;

export interface OutputPolicy {
  container: OutputContainerPolicy;
  directory: OutputDirectoryPolicy;
  filename: OutputFilenamePolicy;
  /** File time preservation options (boolean = all on/off for backward compatibility). */
  preserveFileTimes?: PreserveFileTimes;
}

export const DEFAULT_OUTPUT_POLICY: OutputPolicy = {
  container: { mode: "default" },
  directory: { mode: "sameAsInput" },
  filename: {
    suffix: ".compressed",
    appendTimestamp: false,
    appendEncoderQuality: false,
    randomSuffixLen: undefined,
    appendOrder: ["suffix", "timestamp", "encoderQuality", "random"],
    prefix: undefined,
    regexReplace: undefined,
  },
  preserveFileTimes: false,
};
