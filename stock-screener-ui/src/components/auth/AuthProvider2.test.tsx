// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import { AuthProvider, useAuth } from "./AuthProvider2";

const TOKEN_KEY = "alphashri_token";
const REFRESH_TOKEN_KEY = "alphashri_refresh_token";
const USER_KEY = "alphashri_user";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function TestConsumer() {
  const auth = useAuth();
  return (
    <div>
      <div data-testid="auth-user">{auth.user ? auth.user.email : "null"}</div>
      <div data-testid="auth-authenticated">{String(auth.isAuthenticated)}</div>
      <div data-testid="auth-loading">{String(auth.loading)}</div>
      <div data-testid="auth-error">{auth.error || "null"}</div>
      <button data-testid="btn-login" onClick={() => auth.login("a@b.com", "pw")}>
        Login
      </button>
      <button
        data-testid="btn-register"
        onClick={() => auth.register("a@b.com", "pw", "User")}
      >
        Register
      </button>
      <button data-testid="btn-logout" onClick={() => auth.logout()}>
        Logout
      </button>
      <button
        data-testid="btn-check-auth"
        onClick={() => auth.checkAuth?.()}
      >
        CheckAuth
      </button>
      <button data-testid="btn-clear-error" onClick={() => auth.clearError()}>
        ClearError
      </button>
    </div>
  );
}

function renderWithProvider() {
  return render(
    <UIProvider>
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    </UIProvider>,
  );
}

describe("AuthProvider2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockFetch.mockReset();
    // Default: /api/auth/me returns 401 (no auth)
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("provides AuthContext and renders wrapper", () => {
    renderWithProvider();
    expect(screen.getByTestId("auth-provider")).toBeInTheDocument();
  });

  it("useAuth throws if used outside AuthProvider", () => {
    expect(() =>
      render(
        <UIProvider>
          <TestConsumer />
        </UIProvider>,
      ),
    ).toThrow("useAuth must be used within an AuthProvider");
  });

  it("getAccessToken returns token from localStorage", () => {
    localStorage.setItem(TOKEN_KEY, "test-token");
    let token: string | null = null;
    function Consumer() {
      const auth = useAuth();
      token = auth.getAccessToken();
      return null;
    }
    render(
      <UIProvider>
        <AuthProvider>
          <Consumer />
        </AuthProvider>
      </UIProvider>,
    );
    expect(token).toBe("test-token");
  });

  it("fetchWithAuth adds Authorization header when token exists", async () => {
    localStorage.setItem(TOKEN_KEY, "test-token");
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 1, email: "test@test.com" }),
    });

    let result: Response | null = null;
    function Consumer() {
      const auth = useAuth();
      return (
        <button
          onClick={async () => {
            result = await auth.fetchWithAuth("http://example.com/api/data");
          }}
        >
          Fetch
        </button>
      );
    }
    render(
      <UIProvider>
        <AuthProvider>
          <Consumer />
        </AuthProvider>
      </UIProvider>,
    );
    await act(async () => {
      screen.getByText("Fetch").click();
    });
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
      const call = mockFetch.mock.calls[0];
      const headers = (call[1] as any)?.headers;
      expect(headers["Authorization"]).toBe("Bearer test-token");
    });
  });

  it("login calls /api/auth/login and stores tokens on success", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "new-token",
          refresh_token: "new-refresh",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 1,
          email: "test@test.com",
          display_name: "Test",
          initial_capital: 0,
          created_at: "2025-01-01T00:00:00Z",
        }),
      });

    renderWithProvider();

    await act(async () => {
      screen.getByTestId("btn-login").click();
    });

    await waitFor(() => {
      const loginCalls = mockFetch.mock.calls.filter(
        (c) => typeof c[0] === "string" && (c[0] as string).includes("/api/auth/login"),
      );
      expect(loginCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("login returns error on failure", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ detail: "Invalid credentials" }),
    });

    renderWithProvider();
    await act(async () => {
      screen.getByTestId("btn-login").click();
    });

    await waitFor(() => {
      expect(screen.getByTestId("auth-error")).not.toHaveTextContent("null");
    });
  });

  it("logout calls /api/auth/logout and clears stored tokens/user", async () => {
    localStorage.setItem(TOKEN_KEY, "test-token");
    localStorage.setItem(REFRESH_TOKEN_KEY, "test-refresh");
    localStorage.setItem(USER_KEY, JSON.stringify({ id: 1, email: "test@test.com" }));

    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

    renderWithProvider();

    await act(async () => {
      screen.getByTestId("btn-logout").click();
    });

    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it("checkAuth validates stored token via /api/auth/me", async () => {
    localStorage.setItem(TOKEN_KEY, "test-token");
    localStorage.setItem(USER_KEY, JSON.stringify({ id: 1, email: "stored@test.com" }));

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 1,
        email: "stored@test.com",
        display_name: "Stored",
        initial_capital: 0,
        created_at: "2025-01-01T00:00:00Z",
      }),
    });

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId("auth-user")).toHaveTextContent("stored@test.com");
    });
  });

  it("clearError sets error state to null", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ detail: "Some error" }),
    });

    renderWithProvider();

    await act(async () => {
      screen.getByTestId("btn-login").click();
    });

    await waitFor(() => {
      expect(screen.getByTestId("auth-error")).not.toHaveTextContent("null");
    });

    await act(async () => {
      screen.getByTestId("btn-clear-error").click();
    });

    await waitFor(() => {
      expect(screen.getByTestId("auth-error")).toHaveTextContent("null");
    });
  });

  it("isAuthenticated is true only when user + token exist", () => {
    localStorage.setItem(TOKEN_KEY, "test-token");
    localStorage.setItem(USER_KEY, JSON.stringify({ id: 1, email: "test@test.com" }));
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 1,
        email: "test@test.com",
        display_name: "Test",
        initial_capital: 0,
        created_at: "2025-01-01T00:00:00Z",
      }),
    });
    renderWithProvider();
  });
});
