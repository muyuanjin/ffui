export const stripQuotes = (value: string): string => value.replace(/^"+|"+$/g, "").replace(/^'+|'+$/g, "");

export const wrapWithSameQuotes = (original: string, replacement: string): string => {
  const match = original.match(/^(['"])(.*)\1$/);
  if (match) {
    const quote = match[1];
    return `${quote}${replacement}${quote}`;
  }
  return replacement;
};

export const splitCommandLine = (line: string): string[] => line.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
