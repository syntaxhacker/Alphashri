import { useState } from "react";
import { useAuth } from "./AuthProvider2";
import {
  Flex,
  Paper,
  Stack,
  Group,
  Text,
  TextInput,
  PasswordInput,
  Button,
  Alert,
} from "@mantine/core";

interface LoginFormProps {
  onSuccess?: () => void;
  onSwitchToRegister?: () => void;
}

interface RegisterFormProps {
  onSuccess?: () => void;
  onSwitchToLogin?: () => void;
}

function AuthHeader({ subtitle }: { subtitle: string }) {
  return (
    <Stack gap={4} data-testid="auth-header">
      <Text size="xl" fw={700}>Alphashri</Text>
      <Text size="sm" c="dimmed">{subtitle}</Text>
    </Stack>
  );
}

function AuthError({ message, id }: { message: string; id?: string }) {
  return (
    <Alert color="red" variant="light" data-testid="auth-error" id={id}>
      {message}
    </Alert>
  );
}

function AuthFooter({ prompt, actionLabel, onAction, footerTestId, linkTestId }: {
  prompt: string;
  actionLabel: string;
  onAction: () => void;
  footerTestId: string;
  linkTestId: string;
}) {
  return (
    <Group justify="center" mt="sm" data-testid={footerTestId}>
      <Text size="sm" c="dimmed">{prompt}</Text>
      <Button variant="subtle" size="xs" onClick={onAction} data-testid={linkTestId}>
        {actionLabel}
      </Button>
    </Group>
  );
}

export function LoginForm({ onSuccess, onSwitchToRegister }: LoginFormProps) {
  const { login, error, loading, clearError } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await login(email, password);
    if (result.success) onSuccess?.();
  };

  return (
    <Flex justify="center" align="center" h="100vh" id="login-container" data-testid="login-container">
      <Paper shadow="sm" p="lg" radius="md" w={400} data-testid="login-form" id="login-card">
        <form onSubmit={handleSubmit} id="login-form-element">
          <Stack gap="md">
            <AuthHeader subtitle="Sign in to your account" />
            {error && <AuthError message={error} id="login-error" />}
            <TextInput
              label="Email"
              id="email"
              data-testid="login-email-input"
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
              autoFocus
              size="sm"
            />
            <PasswordInput
              label="Password"
              id="password"
              data-testid="login-password-input"
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              placeholder="Enter your password"
              required
              autoComplete="current-password"
              size="sm"
            />
            <Button type="submit" data-testid="login-submit-btn" loading={loading} fullWidth size="sm">
              Sign In
            </Button>
          </Stack>
        </form>
        {onSwitchToRegister && (
          <AuthFooter
            prompt="Don't have an account?"
            actionLabel="Create Account"
            onAction={() => { clearError(); onSwitchToRegister(); }}
            footerTestId="login-footer"
            linkTestId="register-link"
          />
        )}
      </Paper>
    </Flex>
  );
}

export function validateRegistration(password: string, confirmPassword: string): string | null {
  if (password !== confirmPassword) return "Passwords do not match";
  if (password.length < 6) return "Password must be at least 6 characters";
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
    const ve = validateRegistration(password, confirmPassword);
    if (ve) { setFormError(ve); return; }
    const result = await register(email, password, displayName || undefined);
    if (result.success) onSuccess?.();
  };

  return (
    <Flex justify="center" align="center" h="100vh" id="register-container" data-testid="register-container">
      <Paper shadow="sm" p="lg" radius="md" w={400} data-testid="register-form" id="register-card">
        <form onSubmit={handleSubmit} id="register-form-element">
          <Stack gap="md">
            <AuthHeader subtitle="Create your account" />
            {(formError || error) && <AuthError message={formError || error!} id="register-error" />}
            <TextInput
              label="Email"
              id="reg-email"
              data-testid="register-email-input"
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
              autoFocus
              size="sm"
            />
            <TextInput
              label="Display Name (optional)"
              id="display-name"
              data-testid="display-name-input"
              value={displayName}
              onChange={(e) => setDisplayName(e.currentTarget.value)}
              placeholder="Your name"
              autoComplete="name"
              size="sm"
            />
            <PasswordInput
              label="Password"
              id="reg-password"
              data-testid="register-password-input"
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              placeholder="Create a password (min 6 characters)"
              required
              autoComplete="new-password"
              size="sm"
            />
            <PasswordInput
              label="Confirm Password"
              id="confirm-password"
              data-testid="confirm-password-input"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.currentTarget.value)}
              placeholder="Confirm your password"
              required
              autoComplete="new-password"
              size="sm"
            />
            <Button type="submit" data-testid="register-button" loading={loading} fullWidth size="sm">
              Create Account
            </Button>
          </Stack>
        </form>
        {onSwitchToLogin && (
          <AuthFooter
            prompt="Already have an account?"
            actionLabel="Sign In"
            onAction={() => { clearError(); setFormError(null); onSwitchToLogin(); }}
            footerTestId="register-footer"
            linkTestId="login-link"
          />
        )}
      </Paper>
    </Flex>
  );
}
