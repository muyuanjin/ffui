const pushOpened = (value: unknown) => {
  try {
    const w = window as any;
    if (!Array.isArray(w.__FFUI_OPENED_URLS__)) {
      w.__FFUI_OPENED_URLS__ = [];
    }
    w.__FFUI_OPENED_URLS__.push(String(value));
  } catch {
    // ignore
  }
};

export const openUrl = async (url: string | URL): Promise<void> => {
  pushOpened(url);
};

export const openPath = async (path: string): Promise<void> => {
  pushOpened(path);
};

export const revealItemInDir = async (path: string | string[]): Promise<void> => {
  pushOpened(path);
};
