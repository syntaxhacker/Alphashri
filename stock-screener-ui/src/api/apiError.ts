/**
 * One typed HTTP error contract for API helpers, stores and panels.
 *
 * `message` is always populated, so a panel that renders `error` as a string is
 * unaffected; `status`, `kind` and `retryAfterMs` are the additive detail a
 * status-aware Retry needs. An abort is never routed through here as an error —
 * callers use `isAbortError` to treat it as a silent no-op.
 */

export type ApiErrorKind =
  | "unauthorized"
  /** Legacy alias still emitted by OptionDockError for 401. */
  | "auth"
  | "rate_limited"
  | "aborted"
  | "network"
  | "server"
  | "client"
  | "not_fno"
  | "upstream"
  | "timeout";

export class ApiError extends Error {
  readonly status: number | null;
  readonly retryAfterMs: number | null;
  readonly kind: ApiErrorKind;

  constructor(
    message: string,
    status: number | null,
    retryAfterMs: number | null = null,
    kind?: ApiErrorKind,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.kind = kind ?? kindFromStatus(status);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function kindFromStatus(status: number | null): ApiErrorKind {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 429) return "rate_limited";
  if (status === 0 || status === null) return "network";
  if (status >= 500) return "server";
  return "client";
}

export function retryAfterMsOf(response: Response): number | null {
  const header = response.headers?.get?.("Retry-After");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  }
  return null;
}

/** Build a typed error from a non-ok response, preserving status + Retry-After. */
export async function apiErrorFromResponse(
  response: Response,
  fallback: string,
): Promise<ApiError> {
  let message = fallback;
  try {
    const body = (await response.json()) as {
      detail?: unknown;
      message?: unknown;
      error?: unknown;
    };
    const raw = body?.detail ?? body?.message ?? body?.error;
    if (typeof raw === "string" && raw) {
      message = raw;
    } else if (raw != null && typeof raw === "object") {
      message = JSON.stringify(raw);
    }
  } catch {
    // An unparseable error body still produces a typed error with the status.
  }
  return new ApiError(
    message,
    response.status,
    response.status === 429 ? retryAfterMsOf(response) : null,
  );
}

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ((error as { name?: unknown }).name !== "AbortError") return false;
  return (
    error instanceof Error ||
    (typeof DOMException !== "undefined" && error instanceof DOMException)
  );
}

/** Wrap an untyped throw into the shared contract without losing its message. */
export function asApiError(error: unknown, fallback: string): ApiError {
  if (error instanceof ApiError) return error;
  if (isAbortError(error)) return new ApiError("Request aborted", 0, null, "aborted");
  const message = error instanceof Error && error.message ? error.message : fallback;
  return new ApiError(message, 0, null, "network");
}
