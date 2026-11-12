import { Show, createSignal, type JSX } from "solid-js";
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
} from "@/ui";

interface LoginFormProps {
  onSuccess?: () => void;
  onSwitchToRegister?: () => void;
}

interface RegisterFormProps {
  onSuccess?: () => void;
  onSwitchToLogin?: () => void;
}

function AuthHeader(props: { subtitle: string }) {
  return (
    <Stack gap={4} data-testid="auth-header">
      <Text size="xl" fw={700}>
        Alphashri
      </Text>
      <Text size="sm" c="dimmed">
        {props.subtitle}
      </Text>
    </Stack>
  );
}

function AuthError(props: { message: string; id?: string }) {
  return (
    <Alert color="error" variant="light" data-testid="auth-error" id={props.id}>
      {props.message}
    </Alert>
  );
}

function AuthFooter(props: {
  prompt: string;
  actionLabel: string;
  onAction: () => void;
  footerTestId: string;
  linkTestId: string;
}) {
  return (
    <Group justify="center" mt="sm" data-testid={props.footerTestId}>
      <Text size="sm" c="dimmed">
        {props.prompt}
      </Text>
      <Button variant="subtle" size="xs" onClick={props.onAction} data-testid={props.linkTestId}>
        {props.actionLabel}
      </Button>
    </Group>
  );
}

export function LoginForm(props: LoginFormProps) {
  const auth = useAuth();
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");

  const handleSubmit = async (e: SubmitEvent) => {
    e.preventDefault();
    const result = await auth.login(email(), password());
    if (result.success) props.onSuccess?.();
  };

  return (
    <Flex
      justify="center"
      align="center"
      h="100vh"
      id="login-container"
      data-testid="login-container"
    >
      <Paper shadow="sm" p="lg" radius="md" w={400} data-testid="login-form" id="login-card">
        <form onSubmit={handleSubmit} id="login-form-element">
          <Stack gap="md">
            <AuthHeader subtitle="Sign in to your account" />
            <Show when={auth.error}>{(error) => <AuthError message={error()} id="login-error" />}</Show>
            <TextInput
              label="Email"
              id="email"
              type="email"
              data-testid="login-email-input"
              value={email()}
              onChange={(val) => setEmail(val)}
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
              value={password()}
              onChange={(val) => setPassword(val)}
              placeholder="Enter your password"
              required
              autoComplete="current-password"
              size="sm"
            />
            <Button
              type="submit"
              data-testid="login-submit-btn"
              loading={auth.loading}
              fullWidth
              size="sm"
            >
              Sign In
            </Button>
          </Stack>
        </form>
        <Show when={props.onSwitchToRegister}>
          {(onSwitch) => (
            <AuthFooter
              prompt="Don't have an account?"
              actionLabel="Create Account"
              onAction={() => {
                auth.clearError();
                onSwitch()();
              }}
              footerTestId="login-footer"
              linkTestId="register-link"
            />
          )}
        </Show>
      </Paper>
    </Flex>
  );
}

export function validateRegistration(password: string, confirmPassword: string): string | null {
  if (password !== confirmPassword) return "Passwords do not match";
  if (password.length < 6) return "Password must be at least 6 characters";
  return null;
}

export function RegisterForm(props: RegisterFormProps) {
  const auth = useAuth();
  const [email, setEmail] = createSignal("");
  const [displayName, setDisplayName] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [confirmPassword, setConfirmPassword] = createSignal("");
  const [formError, setFormError] = createSignal<string | null>(null);

  const handleSubmit = async (e: SubmitEvent) => {
    e.preventDefault();
    setFormError(null);
    const ve = validateRegistration(password(), confirmPassword());
    if (ve) {
      setFormError(ve);
      return;
    }
    const result = await auth.register(email(), password(), displayName() || undefined);
    if (result.success) props.onSuccess?.();
  };

  return (
    <Flex
      justify="center"
      align="center"
      h="100vh"
      id="register-container"
      data-testid="register-container"
    >
      <Paper shadow="sm" p="lg" radius="md" w={400} data-testid="register-form" id="register-card">
        <form onSubmit={handleSubmit} id="register-form-element">
          <Stack gap="md">
            <AuthHeader subtitle="Create your account" />
            <Show when={formError() ?? auth.error}>
              {(message) => <AuthError message={message()} id="register-error" />}
            </Show>
            <TextInput
              label="Email"
              id="reg-email"
              type="email"
              data-testid="register-email-input"
              value={email()}
              onChange={(val) => setEmail(val)}
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
              value={displayName()}
              onChange={(val) => setDisplayName(val)}
              placeholder="Your name"
              autoComplete="name"
              size="sm"
            />
            <PasswordInput
              label="Password"
              id="reg-password"
              data-testid="register-password-input"
              value={password()}
              onChange={(val) => setPassword(val)}
              placeholder="Create a password (min 6 characters)"
              required
              autoComplete="new-password"
              size="sm"
            />
            <PasswordInput
              label="Confirm Password"
              id="confirm-password"
              data-testid="confirm-password-input"
              value={confirmPassword()}
              onChange={(val) => setConfirmPassword(val)}
              placeholder="Confirm your password"
              required
              autoComplete="new-password"
              size="sm"
            />
            <Button
              type="submit"
              data-testid="register-button"
              loading={auth.loading}
              fullWidth
              size="sm"
            >
              Create Account
            </Button>
          </Stack>
        </form>
        <Show when={props.onSwitchToLogin}>
          {(onSwitch) => (
            <AuthFooter
              prompt="Already have an account?"
              actionLabel="Sign In"
              onAction={() => {
                auth.clearError();
                setFormError(null);
                onSwitch()();
              }}
              footerTestId="register-footer"
              linkTestId="login-link"
            />
          )}
        </Show>
      </Paper>
    </Flex>
  );
}
