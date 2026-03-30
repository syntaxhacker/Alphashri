/**
 * Auth state management for Alphashri
 */

import { createSubscriber } from "./createSubscriber";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8765";
const TOKEN_KEY = "alphashri_token";
const REFRESH_TOKEN_KEY = "alphashri_refresh_token";
const USER_KEY = "alphashri_user";

// Types
export interface User {
  id: number;
  email: string;
  display_name: string | null;
  initial_capital: number;
  created_at: string;
}

export interface AuthState {
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
async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getAccessToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  return fetch(url, { ...options, headers });
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
      const refreshed = await refreshTokens();
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

async function refreshTokens(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    return false;
  }

  try {
    const response = await fetch(`${API_BASE}/api/auth/refresh`, {
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

// Initialize auth state on load
export function initAuth(): void {
  checkAuth();
}

// Export fetchWithAuth for use in other API modules
export { fetchWithAuth };
