// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { PasswordInput } from "./PasswordInput";

afterEach(cleanup);

describe("PasswordInput — form error accessibility", () => {
  test("a string error is associated with the password input", () => {
    render(() => <PasswordInput data-testid="pi" id="secret" error="Wrong password" />);
    const input = screen.getByTestId("pi");
    const message = screen.getByText("Wrong password");

    expect(input).toHaveAttribute("type", "password");
    expect(message.id).toBe("secret-error");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", message.id);
  });

  test("a JSX error renders as elements, never [object Object]", () => {
    const { container } = render(() => (
      <PasswordInput data-testid="pi" id="secret" error={<span data-testid="jsx-error">Too <i>short</i></span>} />
    ));
    const input = screen.getByTestId("pi");

    expect(screen.getByTestId("jsx-error").querySelector("i")).not.toBeNull();
    expect(container.textContent).not.toContain("[object Object]");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "secret-error");
  });

  test("the reveal toggle still works on an errored field", () => {
    render(() => <PasswordInput data-testid="pi" id="secret" error="Wrong password" />);
    const input = screen.getByTestId("pi") as HTMLInputElement;
    screen.getByRole("button", { name: /toggle password visibility/i }).click();
    expect(input.type).toBe("text");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });
});
