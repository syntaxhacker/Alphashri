/**
 * Shared API request helpers
 * Provides unified methods for making authenticated API calls
 */

import { fetchWithAuth } from "../../state/auth";

import { API_BASE } from "@/api/config";

export interface ApiError {
  detail?: string;
  message?: string;
}

/**
 * Handle API errors uniformly
 * Attempts to parse error details from response, falls back to status text
 */
export async function handleApiError(response: Response, defaultMessage: string): Promise<never> {
  try {
    const error: ApiError = await response.json();
    throw new Error(error.detail || error.message || defaultMessage);
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new Error(defaultMessage);
    }
    throw e;
  }
}

/**
 * Parse a response body as JSON, throwing a uniform error on failure.
 *
 * - If `!response.ok`, delegates to `handleApiError` (reads the server's
 *   `detail`/`message`, falling back to `defaultMessage`).
 * - Otherwise returns `response.json()`. If the body is not parseable JSON,
 *   throws a clear Error carrying `defaultMessage`.
 */
export async function jsonOrThrow<T>(
  response: Response,
  defaultMessage: string,
): Promise<T> {
  if (!response.ok) {
    await handleApiError(response, defaultMessage);
  }
  try {
    return (await response.json()) as T;
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new Error(defaultMessage);
    }
    throw e;
  }
}

/**
 * Fetch a URL and return its JSON body, or `fallback` on any failure.
 *
 * Wraps `fetchWithAuth` plus the non-ok / parse-error handling so callers
 * that intentionally swallow errors (returning `[]`/`null` today) never have
 * to write a `try/catch` or `if (!response.ok)` block. Never throws.
 */
export async function safeGet<T>(
  url: string,
  fallback: T,
  defaultMessage?: string,
  init?: RequestInit,
): Promise<T> {
  try {
    const response = await fetchWithAuth(url, init);
    if (!response.ok) {
      if (defaultMessage) {
        console.error(defaultMessage);
      }
      return fallback;
    }
    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}

/**
 * Build URL with query parameters
 */
export function buildUrl(
  endpoint: string,
  params?: Record<string, string | number | boolean>,
): string {
  if (!params || Object.keys(params).length === 0) {
    return `${API_BASE}${endpoint}`;
  }
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      searchParams.set(key, String(value));
    }
  });
  const queryString = searchParams.toString();
  return queryString ? `${API_BASE}${endpoint}?${queryString}` : `${API_BASE}${endpoint}`;
}

/**
 * Make a GET request with authentication
 */
export async function apiGet<T>(
  endpoint: string,
  params?: Record<string, string | number | boolean>,
): Promise<T> {
  const url = buildUrl(endpoint, params);
  const response = await fetchWithAuth(url);
  if (!response.ok) {
    await handleApiError(response, `Request failed: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Make a POST request with authentication
 */
export async function apiPost<T>(endpoint: string, data?: unknown): Promise<T> {
  const url = buildUrl(endpoint);
  const response = await fetchWithAuth(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: data ? JSON.stringify(data) : undefined,
  });
  if (!response.ok) {
    await handleApiError(response, "POST request failed");
  }
  return response.json();
}

/**
 * Make a PUT request with authentication
 */
export async function apiPut<T>(endpoint: string, data?: unknown): Promise<T> {
  const url = buildUrl(endpoint);
  const response = await fetchWithAuth(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: data ? JSON.stringify(data) : undefined,
  });
  if (!response.ok) {
    await handleApiError(response, "PUT request failed");
  }
  return response.json();
}

/**
 * Make a DELETE request with authentication
 */
export async function apiDelete<T>(endpoint: string): Promise<T> {
  const url = buildUrl(endpoint);
  const response = await fetchWithAuth(url, {
    method: "DELETE",
  });
  if (!response.ok) {
    await handleApiError(response, "DELETE request failed");
  }
  return response.json();
}

/**
 * Make a POST request without body (for action endpoints like start/stop)
 */
export async function apiPostAction<T>(
  endpoint: string,
  params?: Record<string, string | number | boolean>,
): Promise<T> {
  const url = buildUrl(endpoint, params);
  const response = await fetchWithAuth(url, {
    method: "POST",
  });
  if (!response.ok) {
    await handleApiError(response, "Action failed");
  }
  return response.json();
}

// Re-export API_BASE for backward compatibility
export { API_BASE };
