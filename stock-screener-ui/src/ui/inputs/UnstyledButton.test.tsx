// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { typeSize } from "../typography";
import { UnstyledButton } from "./UnstyledButton";

afterEach(cleanup);

describe("UnstyledButton", () => {
  test("is a native non-submitting button named by its visible text", () => {
    const { container } = render(() => <UnstyledButton>Rerun screen</UnstyledButton>);
    const button = container.querySelector("button")!;

    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    expect(screen.getByRole("button", { name: "Rerun screen" })).toBe(button);
  });

  test("forwards caller className, style, id and data-testid verbatim", () => {
    render(() => (
      <UnstyledButton
        id="reset-filters"
        data-testid="reset-filters"
        className="text-fin-primary underline"
        style={{ color: "var(--color-fin-primary)", "font-size": `${typeSize("micro")}px` }}
      >
        Reset
      </UnstyledButton>
    ));
    const button = screen.getByTestId("reset-filters");

    expect(button).toHaveAttribute("id", "reset-filters");
    expect(button.className).toBe("text-fin-primary underline");
    expect(button.style.color).toBe("var(--color-fin-primary)");
    expect(button.style.fontSize).toBe(`${typeSize("micro")}px`);
  });

  test("passes the native mouse event to onClick", () => {
    const onClick = vi.fn<(e: MouseEvent) => void>();
    render(() => (
      <UnstyledButton data-testid="action" onClick={onClick}>
        Go
      </UnstyledButton>
    ));
    const button = screen.getByTestId("action");

    fireEvent.click(button);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick.mock.calls[0][0].type).toBe("click");
    expect(onClick.mock.calls[0][0].target).toBe(button);
  });
});
