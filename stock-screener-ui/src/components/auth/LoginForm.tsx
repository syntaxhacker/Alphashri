import React, { useState } from "react";
import { useAuth } from "./AuthProvider";

interface LoginFormProps {
  onSuccess?: () => void;
  onSwitchToRegister?: () => void;
}

export function LoginForm({ onSuccess, onSwitchToRegister }: LoginFormProps) {
  const { login, error, loading, clearError } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await login(email, password);
    if (result.success && onSuccess) {
      onSuccess();
    }
  };

  const handleSwitch = () => {
    clearError();
    onSwitchToRegister?.();
  };

  return (
    <div className="auth-container" id="login-container" data-testid="login-container">
      <div className="auth-card" data-testid="login-form" id="login-card">
        <div className="auth-header" data-testid="auth-header">
          <h1>🚀 Alphashri</h1>
          <p>Sign in to your account</p>
        </div>

        {error && (
          <div className="auth-error" data-testid="auth-error" id="login-error">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form" id="login-form-element">
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              type="email"
              id="email"
              data-testid="login-email-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              type="password"
              id="password"
              data-testid="login-password-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            className="auth-button"
            data-testid="login-submit-btn"
            disabled={loading}
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        {onSwitchToRegister && (
          <div className="auth-footer" data-testid="login-footer">
            <p>Don't have an account?</p>
            <button
              type="button"
              className="auth-link-button"
              data-testid="register-link"
              onClick={handleSwitch}
            >
              Create Account
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface RegisterFormProps {
  onSuccess?: () => void;
  onSwitchToLogin?: () => void;
}

export function validateRegistration(password: string, confirmPassword: string): string | null {
  if (password !== confirmPassword) {
    return "Passwords do not match";
  }
  if (password.length < 6) {
    return "Password must be at least 6 characters";
  }
  return null;
}

export function RegisterForm({ onSuccess, onSwitchToLogin }: RegisterFormProps) {
  const { register, error, loading, clearError } = useAuth();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const validationError = validateRegistration(password, confirmPassword);
    if (validationError) {
      setFormError(validationError);
      return;
    }

    const result = await register(email, password, displayName || undefined);
    if (result.success && onSuccess) {
      onSuccess();
    }
  };

  const handleSwitch = () => {
    clearError();
    setFormError(null);
    onSwitchToLogin?.();
  };

  const displayError = formError || error;

  return (
    <div className="auth-container" id="register-container" data-testid="register-container">
      <div className="auth-card" data-testid="register-form" id="register-card">
        <div className="auth-header" data-testid="auth-header">
          <h1>🚀 Alphashri</h1>
          <p>Create your account</p>
        </div>

        {displayError && (
          <div className="auth-error" data-testid="auth-error" id="register-error">
            {displayError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form" id="register-form-element">
          <div className="form-group">
            <label htmlFor="reg-email">Email</label>
            <input
              type="email"
              id="reg-email"
              data-testid="register-email-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="display-name">Display Name (optional)</label>
            <input
              type="text"
              id="display-name"
              data-testid="display-name-input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
              autoComplete="name"
            />
          </div>

          <div className="form-group">
            <label htmlFor="reg-password">Password</label>
            <input
              type="password"
              id="reg-password"
              data-testid="register-password-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Create a password (min 6 characters)"
              required
              autoComplete="new-password"
              minLength={6}
            />
          </div>

          <div className="form-group">
            <label htmlFor="confirm-password">Confirm Password</label>
            <input
              type="password"
              id="confirm-password"
              data-testid="confirm-password-input"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm your password"
              required
              autoComplete="new-password"
            />
          </div>

          <button
            type="submit"
            className="auth-button"
            data-testid="register-button"
            disabled={loading}
          >
            {loading ? "Creating account..." : "Create Account"}
          </button>
        </form>

        {onSwitchToLogin && (
          <div className="auth-footer" data-testid="register-footer">
            <p>Already have an account?</p>
            <button
              type="button"
              className="auth-link-button"
              onClick={handleSwitch}
              data-testid="login-link"
            >
              Sign In
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
