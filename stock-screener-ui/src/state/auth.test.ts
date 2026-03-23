// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  authState,
  subscribe,
  getAccessToken,
  getRefreshToken,
  setTokens,
  clearTokens,
  getStoredUser,
  setStoredUser,
  fetchWithAuth,
  login,
  register,
  logout,
  checkAuth,
  type User,
} from "./auth";

const mockUser: User = {
  id: 1,
  email: "test@example.com",
  display_name: "Test User",
  initial_capital: 100000,
  created_at: "2025-01-01T00:00:00Z",
};

function createMockFetchResponse(data: any, ok = true, status = 200) {
  return {
    ok,
    status,
    json: () => Promise.resolve(data),
  };
}

describe("auth state", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    authState.isAuthenticated = false;
    authState.user = null;
    authState.loading = true;
    authState.error = null;
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("has correct initial state", () => {
    expect(authState.isAuthenticated).toBe(false);
    expect(authState.user).toBeNull();
    expect(authState.loading).toBe(true);
    expect(authState.error).toBeNull();
  });
});

describe("subscribe", () => {
  beforeEach(() => {
    localStorage.clear();
    authState.isAuthenticated = false;
    authState.user = null;
    authState.loading = true;
    authState.error = null;
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("returns unsubscribe function", () => {
    const unsub = subscribe(vi.fn());
    expect(typeof unsub).toBe("function");
    unsub();
  });

  it("callback is called on state update via login", async () => {
    const cb = vi.fn();
    const unsub = subscribe(cb);

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockFetchResponse({
          access_token: "at",
          refresh_token: "rt",
        }),
      )
      .mockResolvedValueOnce(createMockFetchResponse(mockUser));
    vi.stubGlobal("fetch", mockFetch);

    await login("test@example.com", "password");
    expect(cb).toHaveBeenCalled();
    unsub();
  });
});

describe("token management", () => {
  beforeEach(() => {
    localStorage.clear();
    authState.isAuthenticated = false;
    authState.user = null;
    authState.loading = true;
    authState.error = null;
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("getAccessToken returns null when no token", () => {
    expect(getAccessToken()).toBeNull();
  });

  it("setTokens stores tokens in localStorage", () => {
    setTokens("access-123", "refresh-456");
    expect(localStorage.getItem("alphashri_token")).toBe("access-123");
    expect(localStorage.getItem("alphashri_refresh_token")).toBe("refresh-456");
  });

  it("getAccessToken returns stored token", () => {
    setTokens("access-123", "refresh-456");
    expect(getAccessToken()).toBe("access-123");
  });

  it("getRefreshToken returns stored refresh token", () => {
    setTokens("access-123", "refresh-456");
    expect(getRefreshToken()).toBe("refresh-456");
  });

  it("clearTokens removes all stored data", () => {
    setTokens("access-123", "refresh-456");
    setStoredUser(mockUser);
    clearTokens();
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
    expect(localStorage.getItem("alphashri_user")).toBeNull();
  });
});

describe("stored user", () => {
  beforeEach(() => {
    localStorage.clear();
    authState.isAuthenticated = false;
    authState.user = null;
    authState.loading = true;
    authState.error = null;
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("getStoredUser returns null when no user stored", () => {
    expect(getStoredUser()).toBeNull();
  });

  it("setStoredUser and getStoredUser round-trip", () => {
    setStoredUser(mockUser);
    expect(getStoredUser()).toEqual(mockUser);
  });

  it("getStoredUser returns null for invalid JSON", () => {
    localStorage.setItem("alphashri_user", "not json");
    expect(getStoredUser()).toBeNull();
  });
});

describe("fetchWithAuth", () => {
  beforeEach(() => {
    localStorage.clear();
    authState.isAuthenticated = false;
    authState.user = null;
    authState.loading = true;
    authState.error = null;
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("includes Authorization header when token exists", async () => {
    setTokens("access-123", "refresh-456");
    const mockFetch = vi.fn().mockResolvedValue(createMockFetchResponse({}));
    vi.stubGlobal("fetch", mockFetch);

    await fetchWithAuth("http://test.com/api/data");
    expect(mockFetch).toHaveBeenCalledWith("http://test.com/api/data", {
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer access-123",
      },
    });
  });

  it("does not include Authorization header when no token", async () => {
    const mockFetch = vi.fn().mockResolvedValue(createMockFetchResponse({}));
    vi.stubGlobal("fetch", mockFetch);

    await fetchWithAuth("http://test.com/api/data");
    expect(mockFetch).toHaveBeenCalledWith("http://test.com/api/data", {
      headers: {
        "Content-Type": "application/json",
      },
    });
  });

  it("merges custom headers", async () => {
    setTokens("access-123", "refresh-456");
    const mockFetch = vi.fn().mockResolvedValue(createMockFetchResponse({}));
    vi.stubGlobal("fetch", mockFetch);

    await fetchWithAuth("http://test.com/api/data", {
      headers: { "X-Custom": "value" } as any,
    });
    const callHeaders = mockFetch.mock.calls[0][1].headers;
    expect(callHeaders["X-Custom"]).toBe("value");
    expect(callHeaders["Authorization"]).toBe("Bearer access-123");
  });
});

describe("login", () => {
  beforeEach(() => {
    localStorage.clear();
    authState.isAuthenticated = false;
    authState.user = null;
    authState.loading = true;
    authState.error = null;
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("successful login sets auth state", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockFetchResponse({
          access_token: "at",
          refresh_token: "rt",
        }),
      )
      .mockResolvedValueOnce(createMockFetchResponse(mockUser));
    vi.stubGlobal("fetch", mockFetch);

    const result = await login("test@example.com", "password");
    expect(result.success).toBe(true);
    expect(authState.isAuthenticated).toBe(true);
    expect(authState.user).toEqual(mockUser);
    expect(authState.loading).toBe(false);
  });

  it("login with API error", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockFetchResponse({ detail: "Invalid credentials" }, false, 401),
      );
    vi.stubGlobal("fetch", mockFetch);

    const result = await login("test@example.com", "wrong");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid credentials");
    expect(authState.isAuthenticated).toBe(false);
    expect(authState.loading).toBe(false);
  });

  it("login with network error", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"));
    vi.stubGlobal("fetch", mockFetch);

    const result = await login("test@example.com", "password");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Network error");
  });

  it("login with generic error detail", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(createMockFetchResponse({ message: "something" }, false, 500));
    vi.stubGlobal("fetch", mockFetch);

    const result = await login("test@example.com", "password");
    expect(result.error).toBe("Login failed");
  });

  it("login falls back to stored user when /me fails", async () => {
    setStoredUser(mockUser);
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockFetchResponse({
          access_token: "at",
          refresh_token: "rt",
        }),
      )
      .mockResolvedValueOnce(createMockFetchResponse({}, false, 500));
    vi.stubGlobal("fetch", mockFetch);

    const result = await login("test@example.com", "password");
    expect(result.success).toBe(true);
    expect(authState.isAuthenticated).toBe(true);
    expect(authState.user).toEqual(mockUser);
  });
});

describe("register", () => {
  beforeEach(() => {
    localStorage.clear();
    authState.isAuthenticated = false;
    authState.user = null;
    authState.loading = true;
    authState.error = null;
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("successful registration", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockFetchResponse({
          access_token: "at",
          refresh_token: "rt",
        }),
      )
      .mockResolvedValueOnce(createMockFetchResponse(mockUser));
    vi.stubGlobal("fetch", mockFetch);

    const result = await register("test@example.com", "password", "Test User");
    expect(result.success).toBe(true);
    expect(authState.isAuthenticated).toBe(true);
  });

  it("registration with API error", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockFetchResponse({ detail: "Email already registered" }, false, 409),
      );
    vi.stubGlobal("fetch", mockFetch);

    const result = await register("test@example.com", "password");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Email already registered");
  });
});

describe("logout", () => {
  beforeEach(() => {
    localStorage.clear();
    authState.isAuthenticated = false;
    authState.user = null;
    authState.loading = true;
    authState.error = null;
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("clears tokens and resets state", async () => {
    setTokens("at", "rt");
    authState.isAuthenticated = true;
    authState.user = mockUser;

    const mockFetch = vi.fn().mockResolvedValue(createMockFetchResponse({}));
    vi.stubGlobal("fetch", mockFetch);

    await logout();
    expect(getAccessToken()).toBeNull();
    expect(authState.isAuthenticated).toBe(false);
    expect(authState.user).toBeNull();
    expect(authState.loading).toBe(false);
    expect(authState.error).toBeNull();
  });

  it("handles logout API error gracefully", async () => {
    setTokens("at", "rt");
    authState.isAuthenticated = true;

    const mockFetch = vi.fn().mockRejectedValue(new Error("logout fail"));
    vi.stubGlobal("fetch", mockFetch);

    await logout();
    expect(authState.isAuthenticated).toBe(false);
    expect(authState.user).toBeNull();
  });

  it("skips logout API call when no refresh token", async () => {
    const mockFetch = vi.fn().mockResolvedValue(createMockFetchResponse({}));
    vi.stubGlobal("fetch", mockFetch);

    await logout();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("checkAuth", () => {
  beforeEach(() => {
    localStorage.clear();
    authState.isAuthenticated = false;
    authState.user = null;
    authState.loading = true;
    authState.error = null;
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("returns false when no access token", async () => {
    const result = await checkAuth();
    expect(result).toBe(false);
    expect(authState.isAuthenticated).toBe(false);
    expect(authState.loading).toBe(false);
  });

  it("returns true with stored user then verifies with /me", async () => {
    setTokens("at", "rt");
    setStoredUser(mockUser);

    const mockFetch = vi.fn().mockResolvedValue(createMockFetchResponse(mockUser));
    vi.stubGlobal("fetch", mockFetch);

    const result = await checkAuth();
    expect(result).toBe(true);
    expect(authState.isAuthenticated).toBe(true);
    expect(authState.user).toEqual(mockUser);
    expect(authState.loading).toBe(false);
  });

  it("clears tokens when /me fails and refresh fails", async () => {
    setTokens("at", "rt");

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(createMockFetchResponse({}, false, 401))
      .mockResolvedValueOnce(createMockFetchResponse({}, false, 401));
    vi.stubGlobal("fetch", mockFetch);

    const result = await checkAuth();
    expect(result).toBe(false);
    expect(authState.isAuthenticated).toBe(false);
    expect(getAccessToken()).toBeNull();
  });

  it("handles network error in checkAuth", async () => {
    setTokens("at", "rt");

    const mockFetch = vi.fn().mockRejectedValue(new Error("net error"));
    vi.stubGlobal("fetch", mockFetch);

    const result = await checkAuth();
    expect(result).toBe(false);
    expect(authState.isAuthenticated).toBe(false);
  });
});
