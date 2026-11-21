/**
 * Auth state management for Alphashri
 */

import { createSubscriber } from "./createSubscriber";

import { apiErrorFromResponse } from "@/api/apiError";
import { API_BASE } from "@/api/config";
const TOKEN_KEY = "alphashri_token";
const REFRESH_TOKEN_KEY = "alphashri_refresh_token";
const USER_KEY = "alphashri_user";
const REFRESH_ENDPOINT = "/api/auth/refresh";
// Refresh ahead of expiry: a token with 5 minutes left cannot finish every in-flight call.
const REFRESH_SKEW_MS = 300_000;

// Types
export interface User {
  id: number;
  email: string;
  display_name: string | null;
  initial_capital: number;
  created_at: string;
}

interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
  loading: boolean;
  error: string | null;
}

// State
export let authState: AuthState = {
  isAuthenticated: false,
  user: null,
  loading: true,
  error: null,
};

const { subscribe, notify: notifyAuth } = createSubscriber();
export { subscribe };

function updateState(newState: Partial<AuthState>): void {
  authState = { ...authState, ...newState };
  notifyAuth();
}

// Token management
export function getAccessToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setTokens(accessToken: string, refreshToken: string): void {
  localStorage.setItem(TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

export function clearTokens(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

function base64UrlDecode(segment: string): string | null {
  try {
    const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
    const remainder = base64.length % 4;
    const padded = remainder === 0 ? base64 : base64 + "=".repeat(4 - remainder);
    return atob(padded);
  } catch {
    return null;
  }
}

/** JWT `exp` as epoch milliseconds, or null when the token carries no decodable `exp`. */
function getTokenExpiry(token: string | null): number | null {
  if (!token) return null;
  const payload = token.split(".")[1];
  if (!payload) return null;
  const json = base64UrlDecode(payload);
  if (!json) return null;
  try {
    const claims = JSON.parse(json) as { exp?: unknown };
    return typeof claims.exp === "number" ? claims.exp * 1000 : null;
  } catch {
    return null;
  }
}

function isExpiringSoon(token: string, now: number = Date.now()): boolean {
  const expiry = getTokenExpiry(token);
  // An opaque token has no provable deadline, so refreshing it on every call would loop.
  return expiry !== null && expiry - now <= REFRESH_SKEW_MS;
}

export function getStoredUser(): User | null {
  const userStr = localStorage.getItem(USER_KEY);
  if (userStr) {
    try {
      return JSON.parse(userStr);
    } catch {
      return null;
    }
  }
  return null;
}

export function setStoredUser(user: User): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

// API helper with auth
function withAuthHeaders(options: RequestInit, token: string | null): RequestInit {
  // FormData bodies must keep the browser-generated multipart Content-Type
  // (including its boundary); forcing application/json breaks file uploads.
  const isFormData =
    typeof FormData !== "undefined" && options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  return { ...options, headers };
}

// Refreshing these would either recurse or spend a refresh token on a dying session.
const NO_PROACTIVE_REFRESH = [REFRESH_ENDPOINT, "/api/auth/logout"];

async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const refreshable = !NO_PROACTIVE_REFRESH.some((path) => url.includes(path));
  let proactiveRefreshSucceeded = false;

  if (refreshable && getRefreshToken()) {
    const token = getAccessToken();
    if (!token || isExpiringSoon(token)) {
      proactiveRefreshSucceeded = await refreshTokensOnce();
    }
  }

  const response = await fetch(url, withAuthHeaders(options, getAccessToken()));

  // A token minted seconds ago that is still rejected means the session is gone;
  // refreshing again would just burn another rotation on the same failure.
  if (response.status !== 401 || !refreshable || proactiveRefreshSucceeded) {
    return response;
  }
  if (!getRefreshToken() || !(await refreshTokensOnce())) {
    return response;
  }
  return fetch(url, withAuthHeaders(options, getAccessToken()));
}

// Auth API functions
async function authenticateWithEndpoint(
  endpoint: string,
  body: Record<string, unknown>,
  fallbackLabel: string,
): Promise<{ success: boolean; error?: string }> {
  updateState({ loading: true, error: null });

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      const error = data.detail || fallbackLabel;
      updateState({ loading: false, error });
      return { success: false, error };
    }

    setTokens(data.access_token, data.refresh_token);

    const userResponse = await fetchWithAuth(`${API_BASE}/api/auth/me`);
    if (userResponse.ok) {
      const user = await userResponse.json();
      setStoredUser(user);
      updateState({
        isAuthenticated: true,
        user,
        loading: false,
        error: null,
      });
    } else {
      updateState({
        isAuthenticated: true,
        user: getStoredUser(),
        loading: false,
      });
    }

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Network error";
    updateState({ loading: false, error: errorMessage });
    return { success: false, error: errorMessage };
  }
}

export async function login(
  email: string,
  password: string,
): Promise<{ success: boolean; error?: string }> {
  return authenticateWithEndpoint("/api/auth/login", { email, password }, "Login failed");
}

export async function register(
  email: string,
  password: string,
  displayName?: string,
): Promise<{ success: boolean; error?: string }> {
  return authenticateWithEndpoint(
    "/api/auth/register",
    { email, password, display_name: displayName },
    "Registration failed",
  );
}

export async function logout(): Promise<void> {
  try {
    const refreshToken = getRefreshToken();
    if (refreshToken) {
      await fetchWithAuth(`${API_BASE}/api/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
    }
  } catch {
    // Ignore logout errors
  }

  clearTokens();
  updateState({
    isAuthenticated: false,
    user: null,
    loading: false,
    error: null,
  });
}

export async function checkAuth(): Promise<boolean> {
  const token = getAccessToken();
  const storedUser = getStoredUser();

  if (!token) {
    updateState({
      isAuthenticated: false,
      user: null,
      loading: false,
    });
    return false;
  }

  // If we have a stored user, use it initially
  if (storedUser) {
    updateState({
      isAuthenticated: true,
      user: storedUser,
      loading: true,
    });
  }

  try {
    const response = await fetchWithAuth(`${API_BASE}/api/auth/me`);
    if (response.ok) {
      const user = await response.json();
      setStoredUser(user);
      updateState({
        isAuthenticated: true,
        user,
        loading: false,
      });
      return true;
    } else {
      // Token invalid, try refresh
      const refreshed = await refreshTokensOnce();
      if (!refreshed) {
        clearTokens();
        updateState({
          isAuthenticated: false,
          user: null,
          loading: false,
        });
        return false;
      }
      return checkAuth();
    }
  } catch {
    updateState({
      isAuthenticated: false,
      user: null,
      loading: false,
    });
    return false;
  }
}

async function performRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    return false;
  }

  try {
    const response = await fetch(`${API_BASE}${REFRESH_ENDPOINT}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!response.ok) {
      return false;
    }

    const data = await response.json();
    setTokens(data.access_token, data.refresh_token);
    return true;
  } catch {
    return false;
  }
}

// One in-flight refresh per tab: the refresh token rotates on use, so parallel
// callers would race and all but the winner would be left with a dead token.
let refreshInFlight: Promise<boolean> | null = null;

function refreshTokensOnce(): Promise<boolean> {
  refreshInFlight ??= performRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

// Export fetchWithAuth for use in other API modules
export { fetchWithAuth };

/** Fetch JSON from an API endpoint with auth, throwing on non-2xx. */
export async function apiFetch(url: string, options?: RequestInit): Promise<any> {
  const response = await fetchWithAuth(url, options);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`API ${response.status}: ${text.slice(0, 200)}`);
  }
  return response.json();
}

/**
 * Typed JSON variant of `fetchWithAuth` for direct callers that need a
 * status-aware error. Additive: `fetchWithAuth` still returns a bare Response
 * and the token refresh / storage / redirect flow is untouched.
 */
export async function fetchJsonWithAuth<T>(
  url: string,
  options?: RequestInit,
  fallback: string = "Request failed",
): Promise<T> {
  const response = await fetchWithAuth(url, options);
  if (!response.ok) throw await apiErrorFromResponse(response, fallback);
  return (await response.json()) as T;
}

/** Build a shared typed error from a non-ok Response without another request. */
export const toApiError = apiErrorFromResponse;
