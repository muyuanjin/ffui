import { parseFfprobeJson } from "../mediaInfo";
import { highlightJsonTokens } from "../jsonHighlight";

type WorkerRequest =
  | { id: number; op: "parseJson"; raw: string }
  | { id: number; op: "stringifyJson"; value: unknown; space?: number }
  | { id: number; op: "parseFfprobeLite"; raw: string }
  | { id: number; op: "highlightJsonTokens"; raw: string | null | undefined };

type WorkerResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

const respondOk = (id: number, result: unknown) => {
  const msg: WorkerResponse = { id, ok: true, result };
  postMessage(msg);
};

const respondErr = (id: number, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const msg: WorkerResponse = { id, ok: false, error: message };
  postMessage(msg);
};

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, op } = event.data;

  try {
    if (op === "parseJson") {
      respondOk(id, JSON.parse(event.data.raw) as unknown);
      return;
    }

    if (op === "stringifyJson") {
      const space = typeof event.data.space === "number" ? event.data.space : undefined;
      respondOk(id, JSON.stringify(event.data.value, null, space));
      return;
    }

    if (op === "parseFfprobeLite") {
      const parsed = parseFfprobeJson(event.data.raw);
      respondOk(id, { ...parsed, raw: null });
      return;
    }

    if (op === "highlightJsonTokens") {
      respondOk(id, highlightJsonTokens(event.data.raw));
      return;
    }

    respondErr(id, `Unsupported op: ${String(op)}`);
  } catch (error) {
    respondErr(id, error);
  }
};
