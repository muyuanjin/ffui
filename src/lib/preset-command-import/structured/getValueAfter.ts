import { stripQuotes } from "../utils";

export const createGetValueAfter = (tokens: string[]) => {
  return (flag: string): string | null => {
    const idx = tokens.findIndex((t) => stripQuotes(t) === flag);
    if (idx < 0) return null;
    const value = tokens[idx + 1];
    if (!value) return null;
    if (stripQuotes(value).startsWith("-")) return null;
    return stripQuotes(value);
  };
};
