import { render } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { createMemoryHistory, MemoryRouter } from "@solidjs/router";
import type { JSX } from "solid-js";
import { vi } from "vitest";
import { AuthProvider, type User } from "../components/auth/AuthProvider2";

// Mock Auth Provider data
let mockUser: User | null = null;
let mockIsAuthenticated = false;

export function setMockUser(user: User | null) {
  mockUser = user;
  mockIsAuthenticated = !!user;
}

// Mock the useAuth hook
vi.mock("../components/auth/AuthProvider2", async () => {
  const actual = await vi.importActual<typeof import("../components/auth/AuthProvider2")>(
    "../components/auth/AuthProvider2",
  );
  return {
    ...actual,
    useAuth: vi.fn(() => ({
      user: mockUser,
      isAuthenticated: mockIsAuthenticated,
      loading: false,
      error: null,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      getAccessToken: vi.fn(() => "mock-token"),
      fetchWithAuth: vi.fn(async (_url: string) => {
        return {
          ok: true,
          json: async () => ({}),
        } as Response;
      }),
      clearError: vi.fn(),
    })),
    AuthProvider: (props: { children: JSX.Element }) => <>{props.children}</>,
  };
});

interface TestWrapperProps {
  children: JSX.Element;
  initialRoute?: string;
  user?: User | null;
  initialState?: Record<string, unknown>;
}

export function TestWrapper(props: TestWrapperProps) {
  setMockUser(props.user ?? null);
  const history = createMemoryHistory();
  history.set({ value: props.initialRoute ?? "/", replace: true, scroll: false });

  return (
    <MemoryRouter history={history}>
      <UIProvider>
        <AuthProvider>{props.children}</AuthProvider>
      </UIProvider>
    </MemoryRouter>
  );
}

export function renderWithProviders(
  ui: () => JSX.Element,
  options?: {
    initialRoute?: string;
    user?: User | null;
  },
): ReturnType<typeof render> {
  return render(ui, {
    wrapper: (props) => (
      <TestWrapper initialRoute={options?.initialRoute} user={options?.user}>
        {props.children}
      </TestWrapper>
    ),
  });
}
