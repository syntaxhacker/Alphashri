/**
 * Shared API request helpers
 * Provides unified methods for making authenticated API calls
 */

import { fetchWithAuth } from "../../state/auth";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8765";

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
