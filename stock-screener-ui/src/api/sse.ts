export interface SseFrame {
  event: string;
  data: string;
}

/**
 * Parse one SSE frame (the text between two blank lines) into `{event, data}`.
 *
 * - lines are split on `\n`
 * * `event:` sets the event name (default `"message"`)
 * * `data:` appends its value; multiple `data:` lines are joined with `\n`
 * * `:` comment lines and unknown fields are ignored
 * * a frame with no `data:` and the default event yields `null`
 */
function parseSseFrame(part: string): SseFrame | null {
  let event = "message";
  const dataLines: string[] = [];
  let hasData = false;

  for (const line of part.split("\n")) {
    if (line.startsWith(":")) {
      continue; // comment line
    }
    if (line.startsWith("event:")) {
      event = line.slice(6);
      if (event.startsWith(" ")) {
        event = event.slice(1);
      }
    } else if (line.startsWith("data:")) {
      let value = line.slice(5);
      if (value.startsWith(" ")) {
        value = value.slice(1);
      }
      dataLines.push(value);
      hasData = true;
    }
    // other fields are ignored
  }

  if (!hasData && event === "message") {
    return null;
  }
  return { event, data: dataLines.join("\n") };
}

function isAbort(err: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true || (err as Error)?.name === "AbortError";
}

/**
 * Iterate SSE frames from a `Response` body.
 *
 * Semantics:
 * - frames are delimited by blank lines (`\n\n`); chunks are buffered so frames
 *   split across chunk boundaries are reassembled
 * - multi-line `data:` values are joined with `\n`
 * - default event name is `"message"`; `:` comment lines are ignored
 * - a trailing buffer is flushed when the stream ends
 * - an `AbortSignal` cancels the reader and releases the lock; abort is silent
 */
export async function* iterateSse(
  response: Response,
  opts: { signal?: AbortSignal } = {},
): AsyncGenerator<SseFrame> {
  const { signal } = opts;
  const body = response.body;
  if (!body) {
    throw new Error("Empty stream response");
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const onAbort = (): void => {
    try {
      reader.cancel();
    } catch {
      /* non-fatal */
    }
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    for (;;) {
      if (signal?.aborted) {
        return;
      }
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const frame = parseSseFrame(part);
        if (frame) {
          yield frame;
        }
      }
    }
    if (buffer.trim()) {
      const frame = parseSseFrame(buffer);
      if (frame) {
        yield frame;
      }
    }
  } catch (err) {
    if (isAbort(err, signal)) {
      return;
    }
    throw err;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    try {
      reader.releaseLock();
    } catch {
      /* non-fatal */
    }
  }
}

/**
 * Consume all SSE frames from a `Response`, invoking `onFrame` for each.
 * Resolves silently on abort; non-abort read errors are thrown.
 */
export async function readSseStream(
  response: Response,
  onFrame: (frame: SseFrame) => void,
  opts: { signal?: AbortSignal } = {},
): Promise<void> {
  for await (const frame of iterateSse(response, opts)) {
    onFrame(frame);
  }
}
