import { prepare, type StreamReply, type StreamRequest } from './stream';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<StreamRequest>) => void) | null;
  postMessage(message: StreamReply, transfer: Transferable[]): void;
};

scope.onmessage = async ({ data }) => {
  try {
    const ready = await prepare(data);
    // Bitmaps and buffers are moved, not copied: the main thread only has to upload them.
    scope.postMessage({ ok: true, ...ready }, [ready.colour, ready.relief, ready.positions.buffer, ready.indices.buffer]);
  } catch (error) {
    scope.postMessage({ ok: false, job: data.job, error: String(error) }, []);
  }
};
