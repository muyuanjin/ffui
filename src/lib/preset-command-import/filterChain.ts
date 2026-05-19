export const stripFilterValueOuterQuotes = (value: string): string => {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  return (first === '"' || first === "'") && first === last ? value.slice(1, -1) : value;
};

export const splitFfmpegFilterChain = (value: string): string[] => {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;

  for (const ch of value) {
    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }
    if (ch === "\\") {
      current += ch;
      escaping = true;
      continue;
    }
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      current += ch;
      quote = ch;
      continue;
    }
    if (ch === ",") {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }

  parts.push(current);
  return parts;
};
