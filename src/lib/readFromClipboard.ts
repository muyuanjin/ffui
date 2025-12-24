export const readFromClipboard = async (): Promise<string | null> => {
  if (typeof navigator === "undefined") return null;
  const clipboard = (navigator as Navigator & { clipboard?: Clipboard }).clipboard;
  if (!clipboard || typeof clipboard.readText !== "function") return null;
  try {
    return await clipboard.readText();
  } catch {
    return null;
  }
};
