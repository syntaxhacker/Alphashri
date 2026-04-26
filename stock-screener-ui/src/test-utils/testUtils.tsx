import { type ReactNode } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider, type User } from "../components/auth/AuthProvider2";
import { useAuth } from "../components/auth/AuthProvider2";

// Mock Auth Provider data
let mockUser: User | null = null;
let mockIsAuthenticated = false;

export function setMockUser(user: User | null) {
  mockUser = user;
  mockIsAuthenticated = !!user;
}

// Mock the useAuth hook
vi.mock("../components/auth/AuthProvider2", () => {
  const actual = vi.importActual("../components/auth/AuthProvider2");
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
      fetchWithAuth: vi.fn(async (url: string) => {
        return {
          ok: true,
          json: async () => ({}),
        } as Response;
      }),
      clearError: vi.fn(),
    })),
    AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  };
});

interface TestWrapperProps {
  children: ReactNode;
  initialRoute?: string;
  user?: User | null;
  initialState?: Record<string, unknown>;
}

export function TestWrapper({ children, initialRoute = "/", user = null }: TestWrapperProps) {
  setMockUser(user);

  return (
    <MemoryRouter initialEntries={[initialRoute]}>
      <MantineProvider>
        <AuthProvider>{children}</AuthProvider>
      </MantineProvider>
    </MemoryRouter>
  );
}

export function renderWithProviders(
  ui: ReactNode,
  options?: {
    initialRoute?: string;
    user?: User | null;
  },
): RenderResult {
  return render(ui, {
    wrapper: ({ children }) => (
      <TestWrapper initialRoute={options?.initialRoute} user={options?.user}>
        {children}
      </TestWrapper>
    ),
  });
}
