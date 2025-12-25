export const appendQueryParam = (url: string, key: string, value: string): string => {
  const [withoutHash, hash = ""] = url.split("#");
  const separator = withoutHash.includes("?") ? "&" : "?";
  const next = `${withoutHash}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  return hash ? `${next}#${hash}` : next;
};
