export type DeepWritable<T> = T extends (...args: unknown[]) => unknown
  ? T
  : T extends ReadonlyArray<infer U>
    ? Array<DeepWritable<U>>
    : T extends object
      ? { -readonly [K in keyof T]: DeepWritable<T[K]> }
      : T;
