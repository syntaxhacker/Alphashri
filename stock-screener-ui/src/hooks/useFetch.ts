/**
 * Custom fetch hook with AbortController support
 * Allows cancelling pending requests when switching screeners
 */

// Store the current abort controller
let currentAbortController: AbortController | null = null

/**
 * Abort any pending fetch request and create a new AbortController
 * Call this before starting a new fetch to cancel any previous pending request
 */
export function abortPendingRequest(): AbortController {
  if (currentAbortController) {
    currentAbortController.abort()
  }
  currentAbortController = new AbortController()
  return currentAbortController
}

/**
 * Get the current abort signal for fetch requests
 */
export function getAbortSignal(): AbortSignal | null {
  return currentAbortController?.signal || null
}

/**
 * Check if an error is due to request abortion
 */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/**
 * Clear the abort controller without aborting
 */
export function clearAbortController(): void {
  currentAbortController = null
}
