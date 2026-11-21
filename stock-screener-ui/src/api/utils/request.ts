/**
 * Shared API request helpers
 * Provides unified methods for making authenticated API calls
 */

import { fetchWithAuth } from "../../state/auth";

import { API_BASE } from "@/api/config";
import { ApiError, apiErrorFromResponse, asApiError } from "../apiError";

/**
 * Handle API errors uniformly. Throws the shared typed error so panels can tell
 * a 401 from a 500; `message` is still populated for existing string consumers.
 */
export async function handleApiError(response: Response, defaultMessage: string): Promise<never> {
  throw await apiErrorFromResponse(response, defaultMessage);
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
      throw new ApiError(defaultMessage, response.status);
    }
    throw e;
  }
}

/**
 * Fetch a URL and return its JSON body.
 *
 * Failures now throw the shared typed `ApiError` instead of silently returning
 * `fallback` — a failure must never look like an empty success. The legacy
 * `_fallback` argument is ignored and kept only so existing call sites compile;
 * there are no in-repo callers (it was only re-exported by `api/utils/index.ts`).
 */
export async function safeGet<T>(
  url: string,
  _fallback: T,
  defaultMessage?: string,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchWithAuth(url, init);
  } catch (error) {
    throw asApiError(error, defaultMessage ?? "Request failed");
  }
  return jsonOrThrow<T>(response, defaultMessage ?? "Request failed");
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
