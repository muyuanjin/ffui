const escapeHtml = (value: string) => {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

type Token = {
  raw: string;
  value: string;
  quoted: boolean;
};

const tokenizeCommand = (input: string): Token[] => {
  const tokens: Token[] = [];
  let index = 0;

  const pushToken = (raw: string, quoted: boolean) => {
    const value = quoted ? raw.slice(1, -1) : raw;
    tokens.push({ raw, value, quoted });
  };

  while (index < input.length) {
    while (index < input.length && /\s/.test(input[index]!)) index += 1;
    if (index >= input.length) break;

    const ch = input[index]!;
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let end = index + 1;
      while (end < input.length && input[end] !== quote) end += 1;
      const raw = input.slice(index, Math.min(end + 1, input.length));
      pushToken(raw, true);
      index = Math.min(end + 1, input.length);
      continue;
    }

    let end = index + 1;
    while (end < input.length && !/\s/.test(input[end]!)) end += 1;
    const raw = input.slice(index, end);
    pushToken(raw, false);
    index = end;
  }

  return tokens;
};

const wrap = (cls: string, raw: string) => `<span class="${cls}">${escapeHtml(raw)}</span>`;

export const renderFfmpegCommandHtml = (command: string) => {
  const tokens = tokenizeCommand(command);
  if (tokens.length === 0) return escapeHtml(command);

  const parts: string[] = [];
  const cmd = tokens[0]!.raw;
  const cmdName = tokens[0]!.value.toLowerCase();
  const isKnownCmd = cmdName === "ffmpeg" || cmdName === "ffprobe" || cmdName === "avconv";

  parts.push(isKnownCmd ? wrap("code-cmd", cmd) : escapeHtml(cmd));

  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    const prev = tokens[i - 1]!;

    parts.push(" ");

    if (token.raw.startsWith("-")) {
      parts.push(wrap("code-flag", token.raw));
      continue;
    }

    const afterFlag = prev.raw.startsWith("-");
    if (afterFlag) {
      const raw = token.quoted ? token.raw : token.value;
      const looksLikeStr = token.quoted || /[\\/.:=,]/.test(token.value) || token.value.includes("_");
      parts.push(wrap(looksLikeStr ? "code-str" : "code-val", raw));
      continue;
    }

    parts.push(escapeHtml(token.raw));
  }

  return parts.join("");
};
