export const stripQuotes = (value: string): string => value.replace(/^"+|"+$/g, "").replace(/^'+|'+$/g, "");

export const wrapWithSameQuotes = (original: string, replacement: string): string => {
  const match = original.match(/^(['"])(.*)\1$/);
  if (match) {
    const quote = match[1];
    return `${quote}${replacement}${quote}`;
  }
  return replacement;
};

export const splitCommandLine = (line: string): string[] => {
  const tokens: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i] ?? "";

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
      continue;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
      continue;
    }

    if (ch === "\\" && inDouble) {
      const next = line[i + 1];
      if (next != null) {
        current += ch;
        current += next;
        i += 1;
        continue;
      }
    }

    if (/\s/.test(ch) && !inSingle && !inDouble) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }

    current += ch;
  }

  if (current) tokens.push(current);
  return tokens;
};
