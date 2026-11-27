// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import type { UICloseButtonProps } from "../types";
import { CloseButton } from "./CloseButton";

afterEach(cleanup);

function renderButton(props: UICloseButtonProps = {}): HTMLButtonElement {
  const { container } = render(() => <CloseButton {...props} />);
  return container.querySelector("button")!;
}

function classSet(variant: UICloseButtonProps["variant"]): Set<string> {
  return new Set(renderButton({ variant }).className.split(/\s+/).filter(Boolean));
}

describe("CloseButton", () => {
  test("maps named sizes and numeric sizes to the square/text steps", () => {
    const cases: Array<[UICloseButtonProps["size"], string[]]> = [
      ["xs", ["w-5", "h-5", "text-xs"]],
      ["sm", ["w-5", "h-5", "text-xs"]],
      ["md", ["w-6", "h-6", "text-sm"]],
      [undefined, ["w-6", "h-6", "text-sm"]],
      ["lg", ["w-8", "h-8", "text-base"]],
      ["xl", ["w-8", "h-8", "text-base"]],
      [20, ["w-5", "h-5", "text-xs"]],
      [30, ["w-6", "h-6", "text-sm"]],
      [40, ["w-8", "h-8", "text-base"]],
    ];

    for (const [size, expected] of cases) {
      const classes = new Set(renderButton({ size }).className.split(/\s+/));
      for (const token of expected) {
        expect(classes, `size ${String(size)} is missing ${token}`).toContain(token);
      }
    }
  });

  test("variants select distinct surface/text treatments", () => {
    const filled = classSet("filled");
    const light = classSet("light");
    const outline = classSet("outline");
    const subtle = classSet("subtle");
    const transparent = classSet("transparent");

    expect(filled).toContain("bg-fin-surface");
    expect(filled).toContain("text-fin-text");
    expect(light).toContain("bg-fin-surface-alt");
    expect(outline).toContain("bg-transparent");
    expect(outline).toContain("border-fin-border");
    expect(subtle).toContain("text-fin-text-muted");
    expect(transparent).toContain("bg-transparent");
    expect(transparent).not.toContain("border-fin-border");
  });

  test("exposes a stable close accessible name and an aria-hidden glyph", () => {
    render(() => <CloseButton />);

    expect(screen.getByRole("button", { name: "close" })).toHaveAttribute("type", "button");
    const glyph = screen.getByText("×");
    expect(glyph).toHaveAttribute("aria-hidden", "true");
  });

  test("calls onClick with the mouse event, and disabled blocks the click", () => {
    const onClick = vi.fn();
    render(() => <CloseButton data-testid="close" onClick={onClick} />);

    fireEvent.click(screen.getByTestId("close"));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick.mock.calls[0]).toHaveLength(1);
    expect(onClick.mock.calls[0][0]).toBeInstanceOf(MouseEvent);

    cleanup();

    render(() => <CloseButton data-testid="close-disabled" disabled onClick={onClick} />);
    const disabled = screen.getByTestId("close-disabled");
    expect(disabled).toBeDisabled();
    expect(disabled.className).toContain("opacity-50");
    expect(disabled.className).toContain("pointer-events-none");
    fireEvent.click(disabled);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
