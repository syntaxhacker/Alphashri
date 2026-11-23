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

function resetAuthState() {
  localStorage.clear();
  authState.isAuthenticated = false;
  authState.user = null;
  authState.loading = true;
  authState.error = null;
  vi.stubGlobal("fetch", vi.fn());
}

function cleanupAuth() {
  vi.restoreAllMocks();
  localStorage.clear();
}

function mockAuthFetchChain(tokenData: any, userData: any) {
  const mockFetch = vi
    .fn()
    .mockResolvedValueOnce(createMockFetchResponse(tokenData))
    .mockResolvedValueOnce(createMockFetchResponse(userData));
  vi.stubGlobal("fetch", mockFetch);
  return mockFetch;
}

const tokenResponse = { access_token: "at", refresh_token: "rt" };

describe("auth state", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetAuthState();
  });

  afterEach(cleanupAuth);

  it("has correct initial state", () => {
    expect(authState.isAuthenticated).toBe(false);
    expect(authState.user).toBeNull();
    expect(authState.loading).toBe(true);
    expect(authState.error).toBeNull();
  });
});

describe("subscribe", () => {
  beforeEach(resetAuthState);
  afterEach(cleanupAuth);

  it("returns unsubscribe function", () => {
    const unsub = subscribe(vi.fn());
    expect(typeof unsub).toBe("function");
    unsub();
  });

  it("callback is called on state update via login", async () => {
    const cb = vi.fn();
    const unsub = subscribe(cb);

    mockAuthFetchChain(tokenResponse, mockUser);

    await login("test@example.com", "password");
    expect(cb).toHaveBeenCalled();
    unsub();
  });
});

describe("token management", () => {
  beforeEach(resetAuthState);
  afterEach(cleanupAuth);

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
  beforeEach(resetAuthState);
  afterEach(cleanupAuth);

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
  beforeEach(resetAuthState);
  afterEach(cleanupAuth);

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

describe("proactive token refresh", () => {
  beforeEach(resetAuthState);
  afterEach(cleanupAuth);

  function fakeJwt(expSecondsFromNow: number): string {
    const payload = btoa(
      JSON.stringify({ sub: "1", exp: Math.floor(Date.now() / 1000) + expSecondsFromNow }),
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    return `header.${payload}.signature`;
  }

  const refreshedTokens = { access_token: "new-at", refresh_token: "new-rt" };

  /** Routes /api/auth/refresh separately from data requests so call counts stay legible. */
  function routeFetch(overrides: {
    refresh?: () => Promise<any>;
    data?: () => Promise<any>;
  }) {
    type FetchFn = (url: string, init?: RequestInit) => Promise<any>;
    const refresh = vi.fn<FetchFn>(
      overrides.refresh ?? (async () => createMockFetchResponse(refreshedTokens)),
    );
    const data = vi.fn<FetchFn>(
      overrides.data ?? (async () => createMockFetchResponse({ ok: true })),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) =>
        String(url).includes("/api/auth/refresh") ? refresh(url, init) : data(url, init),
      ),
    );
    return { refresh, data };
  }

  it("skips refresh when the token has more than 5 minutes left", async () => {
    const { refresh, data } = routeFetch({});
    setTokens(fakeJwt(900), "refresh-456");

    await fetchWithAuth("http://test.com/api/data");

    expect(refresh).not.toHaveBeenCalled();
    expect(data).toHaveBeenCalledTimes(1);
    expect(
      (data.mock.calls[0][1] as RequestInit).headers,
    ).toMatchObject({ Authorization: `Bearer ${getAccessToken()}` });
  });

  it("refreshes before the request when the token expires within 5 minutes", async () => {
    const { refresh, data } = routeFetch({});
    const staleToken = fakeJwt(120);
    setTokens(staleToken, "refresh-456");

    await fetchWithAuth("http://test.com/api/data");

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(data).toHaveBeenCalledTimes(1);
    const headers = (data.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer new-at");
    expect(headers.Authorization).not.toContain(staleToken);
  });

  it("shares one refresh between concurrent callers", async () => {
    const { refresh, data } = routeFetch({});
    setTokens(fakeJwt(120), "refresh-456");

    await Promise.all(
      Array.from({ length: 5 }, () => fetchWithAuth("http://test.com/api/data")),
    );

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(data).toHaveBeenCalledTimes(5);
  });

  it("still sends the request when the proactive refresh fails, then retries once on 401", async () => {
    const { refresh, data } = routeFetch({
      refresh: async () => {
        throw new Error("refresh network error");
      },
      data: async () => createMockFetchResponse({ detail: "expired" }, false, 401),
    });
    const staleToken = fakeJwt(120);
    setTokens(staleToken, "refresh-456");

    const response = await fetchWithAuth("http://test.com/api/data");

    expect(data).toHaveBeenCalledTimes(1);
    expect((data.mock.calls[0][1] as RequestInit).headers).toMatchObject({
      Authorization: `Bearer ${staleToken}`,
    });
    // one failed proactive attempt + the legacy refresh-and-retry attempt
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(401);
  });

  it("does not refresh proactively without a refresh token", async () => {
    const { refresh, data } = routeFetch({});
    localStorage.setItem("alphashri_token", fakeJwt(120));

    await fetchWithAuth("http://test.com/api/data");

    expect(refresh).not.toHaveBeenCalled();
    expect(data).toHaveBeenCalledTimes(1);
  });

  it("never refreshes for the refresh endpoint itself", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(String(url));
        return createMockFetchResponse(refreshedTokens);
      }),
    );
    setTokens(fakeJwt(120), "refresh-456");

    await fetchWithAuth("http://test.com/api/auth/refresh", { method: "POST" });

    // The expiring token must not add a proactive refresh in front of the call itself.
    expect(calls).toEqual(["http://test.com/api/auth/refresh"]);
  });

  it("retries with the new token when a valid token is still rejected", async () => {
    const { refresh, data } = routeFetch({
      data: async () => createMockFetchResponse({ detail: "bad token" }, false, 401),
    });
    setTokens(fakeJwt(900), "refresh-456");

    const response = await fetchWithAuth("http://test.com/api/data");

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(data).toHaveBeenCalledTimes(2);
    expect((data.mock.calls[1][1] as RequestInit).headers).toMatchObject({
      Authorization: "Bearer new-at",
    });
    expect(response.status).toBe(401);
  });

  it("returns 401 without a second attempt when the legacy refresh fails", async () => {
    const { refresh, data } = routeFetch({
      refresh: async () => createMockFetchResponse({}, false, 401),
      data: async () => createMockFetchResponse({ detail: "expired" }, false, 401),
    });
    setTokens(fakeJwt(900), "refresh-456");

    const response = await fetchWithAuth("http://test.com/api/data");

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(data).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(401);
  });
});

describe("login", () => {
  beforeEach(resetAuthState);
  afterEach(cleanupAuth);

  it("successful login sets auth state", async () => {
    mockAuthFetchChain(tokenResponse, mockUser);

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
      .mockResolvedValueOnce(createMockFetchResponse(tokenResponse))
      .mockResolvedValueOnce(createMockFetchResponse({}, false, 500));
    vi.stubGlobal("fetch", mockFetch);

    const result = await login("test@example.com", "password");
    expect(result.success).toBe(true);
    expect(authState.isAuthenticated).toBe(true);
    expect(authState.user).toEqual(mockUser);
  });
});

describe("register", () => {
  beforeEach(resetAuthState);
  afterEach(cleanupAuth);

  it("successful registration", async () => {
    mockAuthFetchChain(tokenResponse, mockUser);

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
  beforeEach(resetAuthState);
  afterEach(cleanupAuth);

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
  beforeEach(resetAuthState);
  afterEach(cleanupAuth);

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

  it("does not refresh when /me fails with 500, even with a valid refresh token", async () => {
    setTokens("at", "rt");
    const refresh = vi.fn(async () => createMockFetchResponse(tokenResponse));
    const me = vi.fn(async () => createMockFetchResponse({}, false, 500));
    vi.stubGlobal("fetch", vi.fn((url: string) =>
      String(url).includes("/api/auth/refresh") ? refresh() : me(),
    ));

    const result = await checkAuth();

    expect(result).toBe(false);
    expect(authState.isAuthenticated).toBe(false);
    expect(getAccessToken()).toBeNull();
    expect(me).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("stops after a bounded retry when refresh succeeds but /me keeps returning 401", async () => {
    setTokens("at", "rt");
    let rotation = 0;
    const refresh = vi.fn(async () => {
      rotation += 1;
      return createMockFetchResponse({
        access_token: `at-${rotation}`,
        refresh_token: `rt-${rotation}`,
      });
    });
    const me = vi.fn(async () => createMockFetchResponse({}, false, 401));
    vi.stubGlobal("fetch", vi.fn((url: string) =>
      String(url).includes("/api/auth/refresh") ? refresh() : me(),
    ));

    const result = await checkAuth();

    expect(result).toBe(false);
    expect(authState.isAuthenticated).toBe(false);
    expect(getAccessToken()).toBeNull();
    expect(me.mock.calls.length).toBeLessThanOrEqual(4);
    expect(refresh.mock.calls.length).toBeLessThanOrEqual(4);
  });
});
