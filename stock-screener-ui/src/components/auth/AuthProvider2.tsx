import {
  Show,
  createContext,
  createEffect,
  createSignal,
  useContext,
  type JSX,
} from "solid-js";
import { Box } from "@/ui";

import { API_BASE } from "@/api/config";
import { fetchWithAuth } from "@/state/auth";
const TOKEN_KEY = "alphashri_token";
const REFRESH_TOKEN_KEY = "alphashri_refresh_token";
const USER_KEY = "alphashri_user";

export interface User {
  id: number;
  email: string;
  display_name: string | null;
  initial_capital: number;
  created_at: string;
  is_admin?: boolean;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (
    email: string,
    password: string,
    displayName?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  getAccessToken: () => string | null;
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>;
  clearError: () => void;
}

export const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}

function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
function getStoredRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

function setStoredTokens(access: string, refresh: string): void {
  localStorage.setItem(TOKEN_KEY, access);
  localStorage.setItem(REFRESH_TOKEN_KEY, refresh);
}

function getStoredUser(): User | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function setStoredUser(user: User): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function clearStoredAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function fetchMe(fetchFn: (url: string) => Promise<Response>): Promise<User | null> {
  const res = await fetchFn(`${API_BASE}/api/auth/me`);
  if (!res.ok) return null;
  const data: User = await res.json();
  setStoredUser(data);
  return data;
}

export function AuthProvider(props: { children?: JSX.Element }) {
  const [user, setUser] = createSignal<User | null>(getStoredUser());
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const authed = () => !!user() && !!getStoredToken();

  const getAccessToken = () => getStoredToken();

  const refreshTokens = async (): Promise<boolean> => {
    const rt = getStoredRefreshToken();
    if (!rt) return false;
    try {
      const res = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: rt }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      setStoredTokens(data.access_token, data.refresh_token);
      return true;
    } catch {
      return false;
    }
  };

  const checkAuth = async () => {
    const token = getStoredToken();
    const storedUser = getStoredUser();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    if (storedUser) setUser(storedUser);
    try {
      let userData = await fetchMe(fetchWithAuth);
      if (!userData) {
        const refreshed = await refreshTokens();
        userData = refreshed ? await fetchMe(fetchWithAuth) : null;
      }
      if (userData) setUser(userData);
      else {
        clearStoredAuth();
        setUser(null);
      }
    } catch {
      if (!storedUser) setUser(null);
    } finally {
      setLoading(false);
    }
  };

  createEffect(() => {
    void checkAuth();
  });

  const authenticate = async (
      endpoint: string,
      body: Record<string, unknown>,
      fallback: string,
    ): Promise<{ success: boolean; error?: string }> => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE}${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) {
          const msg = data.detail || fallback;
          setError(msg);
          return { success: false, error: msg };
        }
        setStoredTokens(data.access_token, data.refresh_token);
        const userData = await fetchMe(async (url) =>
          fetch(url, { headers: { Authorization: `Bearer ${data.access_token}` } }),
        );
        if (userData) setUser(userData);
        return { success: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Network error";
        setError(msg);
        return { success: false, error: msg };
      } finally {
        setLoading(false);
      }
    };

  const login = (email: string, password: string) =>
    authenticate("/api/auth/login", { email, password }, "Login failed");

  const register = (email: string, password: string, displayName?: string) =>
    authenticate(
      "/api/auth/register",
      { email, password, display_name: displayName },
      "Registration failed",
    );

  const logout = async () => {
    try {
      const rt = getStoredRefreshToken();
      if (rt)
        await fetchWithAuth(`${API_BASE}/api/auth/logout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: rt }),
        });
    } catch {
      void 0;
    }
    clearStoredAuth();
    setUser(null);
  };

  const clearError = () => setError(null);

  // Accessor properties, not snapshots: Solid JSX reads these lazily, so
  // consumers always see the live session without extra subscriptions.
  const value: AuthContextType = {
    get user() {
      return user();
    },
    get isAuthenticated() {
      return authed();
    },
    get loading() {
      return loading();
    },
    get error() {
      return error();
    },
    login,
    register,
    logout,
    getAccessToken,
    fetchWithAuth,
    clearError,
  };

  return (
    <Box id="auth-provider" data-testid="auth-provider">
      <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>
    </Box>
  );
}
