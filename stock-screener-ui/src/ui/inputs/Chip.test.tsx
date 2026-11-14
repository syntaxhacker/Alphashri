// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { Chip } from "./Chip";

describe("Chip — interactive filter", () => {
  test("renders the label and exposes its testid", () => {
    render(() => <Chip data-testid="c">RSI</Chip>);
    expect(screen.getByTestId("c")).toHaveTextContent("RSI");
  });

  test("is a 20px rounded rectangle, never a capsule", () => {
    render(() => <Chip data-testid="c2">Mid</Chip>);
    const chip = screen.getByTestId("c2");
    expect(chip.style.height).toBe("20px");
    expect(chip.style.borderRadius).toBe("4px");
    expect(chip.style.fontSize).toBe("11px");
    expect(chip.style.cursor).toBe("pointer");
  });

  test("unchecked keeps a hairline border and no tint", () => {
    render(() => <Chip data-testid="c3">Off</Chip>);
    const chip = screen.getByTestId("c3");
    expect(chip.className).toContain("border-fin-border");
    expect(chip.className).not.toContain("bg-fin-primary/12");
    expect(chip).toHaveAttribute("aria-checked", "false");
  });

  test("checked paints a PRIMARY hairline + tint and shows the selected dot", () => {
    render(() => <Chip checked data-testid="c4">On</Chip>);
    const chip = screen.getByTestId("c4");
    expect(chip).toHaveAttribute("aria-checked", "true");
    expect(chip.className).toContain("border-fin-primary");
    expect(chip.className).toContain("bg-fin-primary/12");
    expect(chip.querySelector("span[aria-hidden='true']")).not.toBeNull();
  });

  test("unchecked hides the selected dot", () => {
    render(() => <Chip data-testid="c5">Off</Chip>);
    expect(screen.getByTestId("c5").querySelector("span[aria-hidden='true']")).toBeNull();
  });

  test("variant=outline keeps the body transparent when checked", () => {
    render(() => <Chip checked variant="outline" data-testid="c6">On</Chip>);
    const chip = screen.getByTestId("c6");
    expect(chip.className).toContain("border-fin-primary");
    expect(chip.className).toContain("bg-transparent");
    expect(chip.className).not.toContain("bg-fin-primary/12");
  });

  test("toggle is uncontrolled by default and reports the next value", () => {
    const onChange = vi.fn();
    render(() => <Chip onChange={onChange} data-testid="c7">Toggle</Chip>);
    const chip = screen.getByTestId("c7");
    fireEvent.click(chip);
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(chip).toHaveAttribute("aria-checked", "true");
    fireEvent.click(chip);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  test("a disabled chip never toggles and reads not-allowed", () => {
    const onChange = vi.fn();
    render(() => <Chip disabled onChange={onChange} data-testid="c8">Off</Chip>);
    const chip = screen.getByTestId("c8");
    expect(chip.style.cursor).toBe("not-allowed");
    fireEvent.click(chip);
    expect(onChange).not.toHaveBeenCalled();
    expect(chip).toHaveAttribute("aria-checked", "false");
  });

  test("size xs keeps the 20px floor so it never reads as a badge", () => {
    render(() => <Chip size="xs" data-testid="c9">Small</Chip>);
    expect(screen.getByTestId("c9").style.height).toBe("20px");
    expect(screen.getByTestId("c9").style.fontSize).toBe("10px");
  });
});
