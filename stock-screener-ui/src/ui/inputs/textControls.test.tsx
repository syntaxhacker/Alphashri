// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { Textarea } from "./Textarea";
import { TextInput } from "./TextInput";
import { NumberInput } from "./NumberInput";
import { PasswordInput } from "./PasswordInput";
import * as palette from "@/ui/palette";

afterEach(cleanup);

const styleOf = (el: Element | null | undefined): string => el?.getAttribute("style") ?? "";
const px = (value: string, prop: string): number => {
  const match = value.match(new RegExp(`${prop}: (-?\\d+(?:\\.\\d+)?)px`));
  return match ? Number(match[1]) : NaN;
};

describe("TextInput — the shared text look", () => {
  it("is a 32px field, 6px radius, 1px border, 13px text, 8px 10px padding", () => {
    render(() => <TextInput data-testid="ti" />);
    const style = styleOf(screen.getByTestId("ti"));
    expect(px(style, "height")).toBe(32);
    expect(style).toContain("border-radius: 6px");
    expect(style).toContain(`border: 1px solid ${palette.BORDER}`);
    expect(px(style, "font-size")).toBe(13);
    expect(style).toContain("padding: 8px 10px");
  });

  it("paints the primary border plus a 1px ring on focus", () => {
    render(() => <TextInput data-testid="ti" />);
    fireEvent.focus(screen.getByTestId("ti"));
    const style = styleOf(screen.getByTestId("ti"));
    expect(style).toContain(`border: 1px solid ${palette.PRIMARY}`);
    expect(style).toContain(`box-shadow: 0 0 0 1px ${palette.PRIMARY}`);
  });

  it("uses the negative border for the error state", () => {
    render(() => <TextInput data-testid="ti" error="Required" />);
    expect(styleOf(screen.getByTestId("ti"))).toContain(`border: 1px solid ${palette.NEGATIVE}`);
  });

  it("fades to 45% on SURFACE_ALT and blocks the cursor when disabled", () => {
    render(() => <TextInput data-testid="ti" disabled />);
    const style = styleOf(screen.getByTestId("ti"));
    expect(style).toContain("opacity: 0.45");
    expect(style).toContain("cursor: not-allowed");
    expect(style).toContain(`background-color: ${palette.SURFACE_ALT}`);
  });
});

describe("PasswordInput — differs by the reveal eye and mono value", () => {
  it("renders a reveal-eye button the plain text field does not have", () => {
    render(() => (
      <div>
        <TextInput data-testid="ti" />
        <PasswordInput data-testid="pi" />
      </div>
    ));
    const eye = screen.getByRole("button", { name: /toggle password visibility/i });
    expect(eye).toHaveAttribute("data-part", "password-toggle");
    expect(eye.querySelector("svg")).not.toBeNull();
    expect(screen.getByTestId("ti-field").querySelector("[data-part='password-toggle']")).toBeNull();
  });

  it("sets the value in monospace with masking letter-spacing", () => {
    render(() => <PasswordInput data-testid="pi" defaultValue="secret" />);
    const style = styleOf(screen.getByTestId("pi"));
    expect(style).toContain(`font-family: ${palette.MONO}`);
    expect(style).toContain("letter-spacing: 0.12em");
  });

  it("keeps the shared field geometry and relies on the eye only", () => {
    render(() => <PasswordInput data-testid="pi" />);
    const style = styleOf(screen.getByTestId("pi"));
    expect(px(style, "height")).toBe(32);
    expect(style).toContain("border-radius: 6px");
  });
});

describe("NumberInput — differs by the stepper affordances", () => {
  it("renders − / + steppers inside the field", () => {
    render(() => <NumberInput data-testid="ni" value={5} onChange={() => {}} />);
    const steppers = screen.getByTestId("ni-steppers");
    expect(steppers).toHaveAttribute("data-part", "number-steppers");
    expect(screen.getByRole("button", { name: /increment value/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /decrement value/i })).toBeInTheDocument();
  });

  it("steps the value within min/max", () => {
    const onChange = vi.fn();
    render(() => <NumberInput data-testid="ni" value={5} min={0} max={6} step={1} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /increment value/i }));
    expect(onChange).toHaveBeenLastCalledWith(6);
    fireEvent.click(screen.getByRole("button", { name: /increment value/i }));
    expect(onChange).toHaveBeenLastCalledWith(6);
    fireEvent.click(screen.getByRole("button", { name: /decrement value/i }));
    expect(onChange).toHaveBeenLastCalledWith(4);
  });

  it("hides the steppers when hideControls is set", () => {
    render(() => <NumberInput data-testid="ni" value={1} hideControls onChange={() => {}} />);
    expect(screen.queryByTestId("ni-steppers")).toBeNull();
  });

  it("keeps the shared field geometry so only the steppers distinguish it", () => {
    render(() => <NumberInput data-testid="ni" />);
    const style = styleOf(within(screen.getByTestId("ni")).getByRole("spinbutton"));
    expect(px(style, "height")).toBe(32);
    expect(style).toContain("border-radius: 6px");
  });
});

describe("Textarea — differs by height and resize handle", () => {
  it("is taller than a single-line text input", () => {
    render(() => (
      <div>
        <TextInput data-testid="ti" />
        <Textarea data-testid="ta" minRows={2} />
      </div>
    ));
    const inputH = px(styleOf(screen.getByTestId("ti")), "height");
    const areaH = px(styleOf(screen.getByTestId("ta")), "height");
    expect(areaH).toBeGreaterThan(inputH);
    expect(areaH).toBe(56);
  });

  it("keeps a visible resize handle and does not set resize: none", () => {
    render(() => <Textarea data-testid="ta" />);
    const style = styleOf(screen.getByTestId("ta"));
    expect(style).toContain("resize: vertical");
    expect(style).not.toContain("resize: none");
  });

  it("top-aligns the text", () => {
    render(() => <Textarea data-testid="ta" />);
    expect(styleOf(screen.getByTestId("ta"))).toContain("vertical-align: top");
  });

  it("grows with minRows and only shrinks sizing when autosize is set", () => {
    render(() => <Textarea data-testid="ta" minRows={4} />);
    expect(px(styleOf(screen.getByTestId("ta")), "height")).toBe(94);
    cleanup();
    render(() => <Textarea data-testid="ta" autosize />);
    expect(styleOf(screen.getByTestId("ta"))).toContain("resize: none");
  });
});

describe("text family — shared state colours", () => {
  it("all four paint the negative border on error", () => {
    render(() => (
      <div>
        <TextInput data-testid="ti" error="x" />
        <NumberInput data-testid="ni" error="x" />
        <PasswordInput data-testid="pi" error="x" />
        <Textarea data-testid="ta" error="x" />
      </div>
    ));
    for (const testId of ["ti", "ni-input", "pi", "ta"]) {
      expect(styleOf(screen.getByTestId(testId))).toContain(`border: 1px solid ${palette.NEGATIVE}`);
    }
  });
});
