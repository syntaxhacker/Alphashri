let currentAbortController: AbortController | null = null;

export function abortPendingRequest(): AbortController {
  if (currentAbortController) {
    currentAbortController.abort();
  }
  currentAbortController = new AbortController();
  return currentAbortController;
}

export function getAbortSignal(): AbortSignal | null {
  return currentAbortController?.signal || null;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function clearAbortController(): void {
  currentAbortController = null;
}
