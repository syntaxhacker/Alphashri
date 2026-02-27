/**
 * Auth components for Alphashri
 */

import * as authState from "../../state/auth";

export function renderAuthContainer(): string {
  const state = authState.authState;

  if (state.loading) {
    return `
      <div class="auth-loading">
        <div class="auth-spinner"></div>
        <span>Loading...</span>
      </div>
    `;
  }

  if (state.isAuthenticated && state.user) {
    return renderUserInfo(state.user);
  }

  return renderLoginForm();
}

export function renderLoginForm(): string {
  const state = authState.authState;

  return `
    <div class="auth-container" id="auth-container">
      <div class="auth-card">
        <div class="auth-header">
          <h1>🚀 Alphashri</h1>
          <p>Sign in to your account</p>
        </div>

        ${
          state.error
            ? `<div class="auth-error">${state.error}</div>`
            : ""
        }

        <form id="auth-login-form" class="auth-form">
          <div class="form-group">
            <label for="auth-email">Email</label>
            <input
              type="email"
              id="auth-email"
              name="email"
              placeholder="you@example.com"
              required
              autocomplete="email"
            />
          </div>

          <div class="form-group">
            <label for="auth-password">Password</label>
            <input
              type="password"
              id="auth-password"
              name="password"
              placeholder="Enter your password"
              required
              autocomplete="current-password"
            />
          </div>

          <button type="submit" class="auth-button" id="auth-submit-btn">
            ${state.loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <div class="auth-footer">
          <p>Don't have an account?</p>
          <button type="button" class="auth-link-button" onclick="window.showRegisterForm()">
            Create Account
          </button>
        </div>
      </div>
    </div>
  `;
}

export function renderRegisterForm(): string {
  const state = authState.authState;

  return `
    <div class="auth-container" id="auth-container">
      <div class="auth-card">
        <div class="auth-header">
          <h1>🚀 Alphashri</h1>
          <p>Create your account</p>
        </div>

        ${
          state.error
            ? `<div class="auth-error">${state.error}</div>`
            : ""
        }

        <form id="auth-register-form" class="auth-form">
          <div class="form-group">
            <label for="auth-email">Email</label>
            <input
              type="email"
              id="auth-email"
              name="email"
              placeholder="you@example.com"
              required
              autocomplete="email"
            />
          </div>

          <div class="form-group">
            <label for="auth-display-name">Display Name (optional)</label>
            <input
              type="text"
              id="auth-display-name"
              name="display_name"
              placeholder="Your name"
              autocomplete="name"
            />
          </div>

          <div class="form-group">
            <label for="auth-password">Password</label>
            <input
              type="password"
              id="auth-password"
              name="password"
              placeholder="Create a password"
              required
              autocomplete="new-password"
              minlength="6"
            />
          </div>

          <div class="form-group">
            <label for="auth-password-confirm">Confirm Password</label>
            <input
              type="password"
              id="auth-password-confirm"
              name="password_confirm"
              placeholder="Confirm your password"
              required
              autocomplete="new-password"
            />
          </div>

          <button type="submit" class="auth-button" id="auth-submit-btn">
            ${state.loading ? "Creating account..." : "Create Account"}
          </button>
        </form>

        <div class="auth-footer">
          <p>Already have an account?</p>
          <button type="button" class="auth-link-button" onclick="window.showLoginForm()">
            Sign In
          </button>
        </div>
      </div>
    </div>
  `;
}

export function renderUserInfo(user: authState.User): string {
  return `
    <div class="auth-user-info">
      <span class="user-name">${user.display_name || user.email.split("@")[0]}</span>
      <button class="logout-button" onclick="window.handleLogout()" title="Sign out">
        Sign Out
      </button>
    </div>
  `;
}

// Window-exposed handlers
declare global {
  interface Window {
    showLoginForm: () => void;
    showRegisterForm: () => void;
    handleLogout: () => void;
    handleLoginSubmit: (e: Event) => Promise<void>;
    handleRegisterSubmit: (e: Event) => Promise<void>;
  }
}

let currentForm: "login" | "register" = "login";

export function initAuthHandlers(render: () => void): void {
  // Subscribe to auth state changes
  authState.subscribe(render);

  // Initialize auth check
  authState.initAuth();

  // Window-exposed functions
  window.showLoginForm = () => {
    currentForm = "login";
    authState.authState.error = null;
    render();
  };

  window.showRegisterForm = () => {
    currentForm = "register";
    authState.authState.error = null;
    render();
  };

  window.handleLogout = async () => {
    await authState.logout();
    render();
  };

  window.handleLoginSubmit = async (e: Event) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const email = (form.querySelector("#auth-email") as HTMLInputElement).value;
    const password = (form.querySelector("#auth-password") as HTMLInputElement)
      .value;

    const result = await authState.login(email, password);
    if (result.success) {
      render();
    }
  };

  window.handleRegisterSubmit = async (e: Event) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const email = (form.querySelector("#auth-email") as HTMLInputElement).value;
    const displayName = (
      form.querySelector("#auth-display-name") as HTMLInputElement
    )?.value;
    const password = (form.querySelector("#auth-password") as HTMLInputElement)
      .value;
    const passwordConfirm = (
      form.querySelector("#auth-password-confirm") as HTMLInputElement
    )?.value;

    if (password !== passwordConfirm) {
      authState.authState.error = "Passwords do not match";
      render();
      return;
    }

    const result = await authState.register(email, password, displayName);
    if (result.success) {
      render();
    }
  };

  // Attach form handlers after render
  setTimeout(() => {
    const loginForm = document.getElementById("auth-login-form");
    if (loginForm) {
      loginForm.addEventListener("submit", window.handleLoginSubmit);
    }

    const registerForm = document.getElementById("auth-register-form");
    if (registerForm) {
      registerForm.addEventListener("submit", window.handleRegisterSubmit);
    }
  }, 0);
}

export function getAuthContainer(): string {
  if (currentForm === "register") {
    return renderRegisterForm();
  }
  return renderLoginForm();
}
