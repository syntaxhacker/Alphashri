import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";

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
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

// Token management helpers
function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function getStoredRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

function setStoredTokens(accessToken: string, refreshToken: string): void {
  localStorage.setItem(TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

function getStoredUser(): User | null {
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

function setStoredUser(user: User): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function clearStoredAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(getStoredUser());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isAuthenticated = !!user && !!getStoredToken();

  const getAccessToken = useCallback(() => getStoredToken(), []);

  const fetchWithAuth = useCallback(
    async (url: string, options: RequestInit = {}): Promise<Response> => {
      const token = getStoredToken();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(options.headers as Record<string, string>),
      };

      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      return fetch(url, { ...options, headers });
    },
    [],
  );

  const refreshTokens = useCallback(async (): Promise<boolean> => {
    const refreshToken = getStoredRefreshToken();
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
      setStoredTokens(data.access_token, data.refresh_token);
      return true;
    } catch {
      return false;
    }
  }, []);

  const checkAuth = useCallback(async () => {
    const token = getStoredToken();
    const storedUser = getStoredUser();

    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }

    // If we have a stored user, use it initially
    if (storedUser) {
      setUser(storedUser);
    }

    try {
      const response = await fetchWithAuth(`${API_BASE}/api/auth/me`);
      if (response.ok) {
        const userData = await response.json();
        setStoredUser(userData);
        setUser(userData);
      } else {
        // Token invalid, try refresh
        const refreshed = await refreshTokens();
        if (!refreshed) {
          clearStoredAuth();
          setUser(null);
        } else {
          // Try again with new token
          const retryResponse = await fetchWithAuth(`${API_BASE}/api/auth/me`);
          if (retryResponse.ok) {
            const userData = await retryResponse.json();
            setStoredUser(userData);
            setUser(userData);
          } else {
            clearStoredAuth();
            setUser(null);
          }
        }
      }
    } catch {
      // Network error - keep stored user if we have one
      if (!storedUser) {
        setUser(null);
      }
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, refreshTokens]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = useCallback(
    async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`${API_BASE}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });

        const data = await response.json();

        if (!response.ok) {
          const errorMessage = data.detail || "Login failed";
          setError(errorMessage);
          setLoading(false);
          return { success: false, error: errorMessage };
        }

        setStoredTokens(data.access_token, data.refresh_token);

        // Fetch user info
        const userResponse = await fetch(`${API_BASE}/api/auth/me`, {
          headers: { Authorization: `Bearer ${data.access_token}` },
        });

        if (userResponse.ok) {
          const userData = await userResponse.json();
          setStoredUser(userData);
          setUser(userData);
        }

        setLoading(false);
        return { success: true };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Network error";
        setError(errorMessage);
        setLoading(false);
        return { success: false, error: errorMessage };
      }
    },
    [],
  );

  const register = useCallback(
    async (
      email: string,
      password: string,
      displayName?: string,
    ): Promise<{ success: boolean; error?: string }> => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`${API_BASE}/api/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, display_name: displayName }),
        });

        const data = await response.json();

        if (!response.ok) {
          const errorMessage = data.detail || "Registration failed";
          setError(errorMessage);
          setLoading(false);
          return { success: false, error: errorMessage };
        }

        setStoredTokens(data.access_token, data.refresh_token);

        // Fetch user info
        const userResponse = await fetch(`${API_BASE}/api/auth/me`, {
          headers: { Authorization: `Bearer ${data.access_token}` },
        });

        if (userResponse.ok) {
          const userData = await userResponse.json();
          setStoredUser(userData);
          setUser(userData);
        }

        setLoading(false);
        return { success: true };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Network error";
        setError(errorMessage);
        setLoading(false);
        return { success: false, error: errorMessage };
      }
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      const refreshToken = getStoredRefreshToken();
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

    clearStoredAuth();
    setUser(null);
  }, [fetchWithAuth]);

  const clearError = useCallback(() => setError(null), []);

  const value: AuthContextType = {
    user,
    isAuthenticated,
    loading,
    error,
    login,
    register,
    logout,
    getAccessToken,
    fetchWithAuth,
    clearError,
  };

  return (
    <div id="auth-provider" data-testid="auth-provider">
      <AuthContext.Provider value={value}>
        {children}
      </AuthContext.Provider>
    </div>
  );
}
