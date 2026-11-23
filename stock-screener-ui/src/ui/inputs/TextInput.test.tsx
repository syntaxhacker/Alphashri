// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { TextInput } from "./TextInput";

afterEach(cleanup);

describe("TextInput — form error accessibility", () => {
  test("a string error is rendered and associated with the input", () => {
    render(() => <TextInput data-testid="ti" id="ticker" error="Ticker is required" />);
    const input = screen.getByTestId("ti");
    const message = screen.getByText("Ticker is required");

    expect(input.id).toBe("ticker");
    expect(message.id).toBe("ticker-error");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", message.id);
  });

  test("a JSX error renders as elements, never [object Object]", () => {
    const { container } = render(() => (
      <TextInput
        data-testid="ti"
        id="ticker"
        error={<strong data-testid="jsx-error">Required <em>now</em></strong>}
      />
    ));
    const input = screen.getByTestId("ti");
    const message = screen.getByTestId("jsx-error");

    expect(message.tagName).toBe("STRONG");
    expect(message.querySelector("em")).not.toBeNull();
    expect(container.textContent).toContain("Required now");
    expect(container.textContent).not.toContain("[object Object]");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", message.parentElement!.id);
    expect(message.parentElement!.id).toBe("ticker-error");
  });

  test("a description is associated with the input when there is no error", () => {
    render(() => (
      <TextInput data-testid="ti" id="ticker" description={<span data-testid="desc">Pick a ticker</span>} />
    ));
    const input = screen.getByTestId("ti");
    const helper = screen.getByTestId("desc").parentElement!;

    expect(input).toHaveAttribute("aria-invalid", "false");
    expect(input).toHaveAttribute("aria-describedby", "ticker-error");
    expect(helper.id).toBe("ticker-error");
  });

  test("with no message the input is valid and has no describedby", () => {
    render(() => <TextInput data-testid="ti" />);
    const input = screen.getByTestId("ti");
    expect(input).toHaveAttribute("aria-invalid", "false");
    expect(input).not.toHaveAttribute("aria-describedby");
  });

  test("a caller-supplied aria-describedby survives alongside the error", () => {
    const native: Record<string, string> = { "aria-describedby": "hint" };
    render(() => (
      <div>
        <span id="hint">Type a ticker</span>
        <TextInput data-testid="ti" id="ticker" error="Required" {...native} />
      </div>
    ));
    const ids = (screen.getByTestId("ti").getAttribute("aria-describedby") ?? "").split(/\s+/);
    expect(ids).toContain("hint");
    expect(ids).toContain("ticker-error");
  });

  test("error={true} flags the input without printing the word true", () => {
    render(() => <TextInput data-testid="ti" error />);
    const input = screen.getByTestId("ti");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).not.toHaveAttribute("aria-describedby");
    expect(screen.getByTestId("ti-field").textContent).not.toContain("true");
  });
});
