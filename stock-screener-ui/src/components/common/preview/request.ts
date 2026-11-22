import type { ChartPreviewData } from "../../../api/chartPreview";

export const RETRY_MESSAGE = "Couldn't load chart";

const ERROR_DEDUP_MS = 5000;
let lastErrorNotified = "";
let lastErrorTime = 0;

export function notifyErrorOnce(
  notify: { error: (title: string, message: string) => void },
  message: string,
) {
  const now = Date.now();
  if (message === lastErrorNotified && now - lastErrorTime < ERROR_DEDUP_MS) return;
  lastErrorNotified = message;
  lastErrorTime = now;
  notify.error("Chart Error", message);
}

export interface PreviewRequest {
  readonly requestId: number;
  readonly controller: AbortController;
}

/**
 * Monotonic token plus abort owner. Each new request invalidates the previous
 * one so a slow response cannot overwrite a newer one — even when the
 * symbol/timeframe cycle returns to its previous value.
 */
export class StaleRequestGuard {
  private requestId = 0;
  private controller: AbortController | null = null;

  begin(): PreviewRequest {
    const requestId = ++this.requestId;
    const controller = new AbortController();
    this.controller?.abort();
    this.controller = controller;
    return { requestId, controller };
  }

  isCurrent(request: PreviewRequest): boolean {
    return !request.controller.signal.aborted && request.requestId === this.requestId;
  }

  cancel(): void {
    this.requestId += 1;
    this.controller?.abort();
    this.controller = null;
  }

  get active(): boolean {
    return this.controller !== null;
  }
}

export type PreviewResponse =
  | { status: "data"; data: ChartPreviewData }
  | { status: "transport" }
  | { status: "server-error"; message: string };

export function classifyPreviewResponse(data: ChartPreviewData | null): PreviewResponse {
  if (!data) return { status: "transport" };
  if (data.error) return { status: "server-error", message: data.error };
  return { status: "data", data };
}
