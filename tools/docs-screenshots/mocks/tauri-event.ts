export type UnlistenFn = () => void;

export const listen = async <T>(
  _event: string,
  _handler: (event: { payload: T }) => void,
): Promise<UnlistenFn> => {
  return () => {};
};

