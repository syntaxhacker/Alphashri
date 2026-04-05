import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { Box } from "@mantine/core";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8765";
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

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}

function getStoredToken(): string | null { return localStorage.getItem(TOKEN_KEY); }
function getStoredRefreshToken(): string | null { return localStorage.getItem(REFRESH_TOKEN_KEY); }

function setStoredTokens(access: string, refresh: string): void {
  localStorage.setItem(TOKEN_KEY, access);
  localStorage.setItem(REFRESH_TOKEN_KEY, refresh);
}

function getStoredUser(): User | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
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

function useAuthState() {
  const [user, setUser] = useState<User | null>(getStoredUser());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  return { user, setUser, loading, setLoading, error, setError };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { user, setUser, loading, setLoading, error, setError } = useAuthState();
  const isAuthenticated = !!user && !!getStoredToken();

  const getAccessToken = useCallback(() => getStoredToken(), []);

  const fetchWithAuth = useCallback(async (url: string, options: RequestInit = {}): Promise<Response> => {
    const token = getStoredToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return fetch(url, { ...options, headers });
  }, []);

  const refreshTokens = useCallback(async (): Promise<boolean> => {
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
  }, []);

  const checkAuth = useCallback(async () => {
    const token = getStoredToken();
    const storedUser = getStoredUser();
    if (!token) { setUser(null); setLoading(false); return; }
    if (storedUser) setUser(storedUser);
    try {
      let userData = await fetchMe(fetchWithAuth);
      if (!userData) {
        const refreshed = await refreshTokens();
        userData = refreshed ? await fetchMe(fetchWithAuth) : null;
      }
      if (userData) setUser(userData);
      else { clearStoredAuth(); setUser(null); }
    } catch {
      if (!storedUser) setUser(null);
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, refreshTokens]);

  useEffect(() => { checkAuth(); }, [checkAuth]);

  const authenticate = useCallback(async (
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
  }, []);

  const login = useCallback(
    (email: string, password: string) =>
      authenticate("/api/auth/login", { email, password }, "Login failed"),
    [authenticate],
  );

  const register = useCallback(
    (email: string, password: string, displayName?: string) =>
      authenticate("/api/auth/register", { email, password, display_name: displayName }, "Registration failed"),
    [authenticate],
  );

  const logout = useCallback(async () => {
    try {
      const rt = getStoredRefreshToken();
      if (rt) await fetchWithAuth(`${API_BASE}/api/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: rt }),
      });
    } catch {
      void 0;
    }
    clearStoredAuth();
    setUser(null);
  }, [fetchWithAuth]);

  const clearError = useCallback(() => setError(null), []);

  const value: AuthContextType = {
    user, isAuthenticated, loading, error,
    login, register, logout, getAccessToken, fetchWithAuth, clearError,
  };

  return (
    <Box id="auth-provider" data-testid="auth-provider">
      <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
    </Box>
  );
}
