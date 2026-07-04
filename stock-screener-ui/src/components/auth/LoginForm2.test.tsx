// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import { LoginForm, RegisterForm } from "./LoginForm2";

const mockLogin = vi.fn();
const mockRegister = vi.fn();
const mockClearError = vi.fn();

const mockUseAuth = vi.fn(() => ({
  login: mockLogin,
  register: mockRegister,
  error: null,
  loading: false,
  clearError: mockClearError,
}));

vi.mock("./AuthProvider2", () => ({
  useAuth: (...args: any[]) => mockUseAuth(...args),
}));

function renderWithProvider(ui: React.ReactElement) {
  return render(<UIProvider>{ui}</UIProvider>);
}

describe("LoginForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      login: mockLogin,
      register: mockRegister,
      error: null,
      loading: false,
      clearError: mockClearError,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders login-form with email, password inputs, and submit button", () => {
    renderWithProvider(<LoginForm />);
    expect(screen.getByTestId("login-form")).toBeInTheDocument();
    expect(screen.getByTestId("login-email-input")).toBeInTheDocument();
    expect(screen.getByTestId("login-password-input")).toBeInTheDocument();
    expect(screen.getByTestId("login-submit-btn")).toBeInTheDocument();
  });

  it("renders header with subtitle", () => {
    renderWithProvider(<LoginForm />);
    expect(screen.getByText("Alphashri")).toBeInTheDocument();
    expect(screen.getByText("Sign in to your account")).toBeInTheDocument();
  });

  it("shows error alert when error is set from useAuth", () => {
    mockUseAuth.mockReturnValue({
      login: mockLogin,
      register: mockRegister,
      error: "Invalid credentials",
      loading: false,
      clearError: mockClearError,
    });
    renderWithProvider(<LoginForm />);
    expect(screen.getByTestId("auth-error")).toHaveTextContent("Invalid credentials");
  });

  it("calls login(email, password) on form submit", async () => {
    const user = userEvent.setup();
    mockLogin.mockResolvedValue({ success: true });
    renderWithProvider(<LoginForm />);
    await user.type(screen.getByTestId("login-email-input"), "test@example.com");
    await user.type(screen.getByTestId("login-password-input"), "password123");
    await user.click(screen.getByTestId("login-submit-btn"));
    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith("test@example.com", "password123");
    });
  });

  it("calls onSuccess callback when login succeeds", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    mockLogin.mockResolvedValue({ success: true });
    renderWithProvider(<LoginForm onSuccess={onSuccess} />);
    await user.type(screen.getByTestId("login-email-input"), "test@example.com");
    await user.type(screen.getByTestId("login-password-input"), "password123");
    await user.click(screen.getByTestId("login-submit-btn"));
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
    });
  });

  it("shows loading state on submit button", () => {
    mockUseAuth.mockReturnValue({
      login: mockLogin,
      register: mockRegister,
      error: null,
      loading: true,
      clearError: mockClearError,
    });
    renderWithProvider(<LoginForm />);
    const submitBtn = screen.getByTestId("login-submit-btn");
    expect(submitBtn).toBeDisabled();
  });

  it("register link is shown when onSwitchToRegister is provided", () => {
    renderWithProvider(<LoginForm onSwitchToRegister={vi.fn()} />);
    expect(screen.getByTestId("register-link")).toBeInTheDocument();
  });

  it("clicking register link calls clearError then onSwitchToRegister", async () => {
    const user = userEvent.setup();
    const onSwitchToRegister = vi.fn();
    mockClearError.mockImplementation(() => {});
    renderWithProvider(<LoginForm onSwitchToRegister={onSwitchToRegister} />);
    await user.click(screen.getByTestId("register-link"));
    expect(mockClearError).toHaveBeenCalled();
    expect(onSwitchToRegister).toHaveBeenCalled();
  });
});

describe("RegisterForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      login: mockLogin,
      register: mockRegister,
      error: null,
      loading: false,
      clearError: mockClearError,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders register-form with all required fields", () => {
    renderWithProvider(<RegisterForm />);
    expect(screen.getByTestId("register-form")).toBeInTheDocument();
    expect(screen.getByTestId("register-email-input")).toBeInTheDocument();
    expect(screen.getByTestId("display-name-input")).toBeInTheDocument();
    expect(screen.getByTestId("register-password-input")).toBeInTheDocument();
    expect(screen.getByTestId("confirm-password-input")).toBeInTheDocument();
    expect(screen.getByTestId("register-button")).toBeInTheDocument();
  });

  it("shows error from form validation on register render with error state", () => {
    const mockRegisterWithError = vi.fn();
    mockUseAuth.mockReturnValue({
      login: mockLogin,
      register: mockRegisterWithError,
      error: null,
      loading: false,
      clearError: mockClearError,
    });
    renderWithProvider(<RegisterForm />);
    expect(screen.getByTestId("register-form")).toBeInTheDocument();
  });

  it("shows error from useAuth.error when API call fails", async () => {
    mockUseAuth.mockReturnValue({
      login: mockLogin,
      register: mockRegister,
      error: "Email already exists",
      loading: false,
      clearError: mockClearError,
    });
    renderWithProvider(<RegisterForm />);
    expect(screen.getByText("Email already exists")).toBeInTheDocument();
  });

  it("calls register(email, password, displayName) on submit", async () => {
    const user = userEvent.setup();
    mockRegister.mockResolvedValue({ success: true });
    renderWithProvider(<RegisterForm />);
    const emailInput = screen.getByTestId("register-email-input");
    const nameInput = screen.getByTestId("display-name-input");
    const pwInput = screen.getByTestId("register-password-input");
    const confirmInput = screen.getByTestId("confirm-password-input");
    await user.type(emailInput, "new@test.com");
    await user.type(nameInput, "Test User");
    await user.type(pwInput, "password123");
    await user.type(confirmInput, "password123");
    await user.click(screen.getByTestId("register-button"));
    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith("new@test.com", "password123", "Test User");
    });
  });

  it("calls onSuccess callback when registration succeeds", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    mockRegister.mockResolvedValue({ success: true });
    renderWithProvider(<RegisterForm onSuccess={onSuccess} />);
    const emailInput = screen.getByTestId("register-email-input");
    const pwInput = screen.getByTestId("register-password-input");
    const confirmInput = screen.getByTestId("confirm-password-input");
    await user.type(emailInput, "new@test.com");
    await user.type(pwInput, "password123");
    await user.type(confirmInput, "password123");
    await user.click(screen.getByTestId("register-button"));
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
    });
  });

  it("login link is shown when onSwitchToLogin is provided", () => {
    renderWithProvider(<RegisterForm onSwitchToLogin={vi.fn()} />);
    expect(screen.getByTestId("login-link")).toBeInTheDocument();
  });

  it("clicking login link clears errors and calls onSwitchToLogin", async () => {
    const user = userEvent.setup();
    const onSwitchToLogin = vi.fn();
    renderWithProvider(<RegisterForm onSwitchToLogin={onSwitchToLogin} />);
    await user.click(screen.getByTestId("login-link"));
    expect(mockClearError).toHaveBeenCalled();
    expect(onSwitchToLogin).toHaveBeenCalled();
  });
});
