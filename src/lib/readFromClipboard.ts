export const readFromClipboard = async (): Promise<string | null> => {
  if (typeof navigator === "undefined") return null;
  const clipboard = (navigator as any).clipboard as { readText?: () => Promise<string> } | undefined;
  if (!clipboard?.readText) return null;
  try {
    return await clipboard.readText();
  } catch {
    return null;
  }
};
