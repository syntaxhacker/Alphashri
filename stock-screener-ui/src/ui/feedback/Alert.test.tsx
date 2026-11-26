// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import {
  ALERT_TONE_SUFFIXES,
  ALERT_TOKEN_NAMES,
  TONE_ANCHORS,
  UI_TONES,
  alertTone,
  componentTokenProperty,
} from "../componentTokens";
import * as palette from "../palette";
import { pickTextColor } from "@/utils/contrast";
import { Alert } from "./Alert";

describe("Alert", () => {
  test("renders role=alert with title and children", () => {
    render(() => (
      <Alert title="Heads up" data-testid="al">
        Something happened
      </Alert>));
    const alert = screen.getByTestId("al");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert.textContent).toContain("Heads up");
    expect(alert.textContent).toContain("Something happened");
  });

  test("filled error variant renders and close button calls onClose", () => {
    const onClose = vi.fn();
    render(() => (
      <Alert variant="filled" color="error" withCloseButton onClose={onClose} data-testid="al2">
        failed
      </Alert>));
    expect(screen.getByText("failed")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("action sits beside the text block and leaves the close button working", () => {
    const onClose = vi.fn();
    render(() => (
      <Alert
        title="Connect your broker"
        icon={<span>!</span>}
        action={<a href="/settings">Open Settings</a>}
        withCloseButton
        onClose={onClose}
        data-testid="al-action"
      >
        Reconnect to load data.
      </Alert>));

    const alert = screen.getByTestId("al-action");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toHaveClass("flex-wrap");
    expect(alert.querySelector('[aria-hidden="true"]')).toHaveTextContent("!");

    const action = screen.getByRole("link", { name: "Open Settings" });
    expect(alert).toContainElement(action);
    const textBlock = screen.getByText("Reconnect to load data.").parentElement;
    expect(textBlock).not.toContainElement(action);
    expect(action.parentElement?.previousElementSibling).toBe(textBlock);

    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("icon and title are optional", () => {
    render(() => <Alert data-testid="al3">plain</Alert>);
    expect(screen.getByTestId("al3").textContent).toBe("plain");
    expect(screen.getByTestId("al3").querySelector("button")).toBeNull();
  });

  test("transparent variant really has no fill or border", () => {
    render(() => <Alert variant="transparent" color="warning" data-testid="al4">quiet</Alert>);
    const el = screen.getByTestId("al4");
    expect(el.style.backgroundColor).toBe("transparent");
    expect(el.style.border).toBe("");
    expect(el.style.color).toBe("var(--ui-alert-warning-main)");
  });

  test("filled alerts pick an ink that clears the contrast floor", () => {
    render(() => <Alert variant="filled" color="warning" data-testid="al5">watch</Alert>);
    const filled = screen.getByTestId("al5");
    expect(filled.style.backgroundColor).toBe("var(--ui-alert-warning-main)");
    expect(filled.style.color).toBe(pickTextColor(TONE_ANCHORS.warning, palette.TEXT, palette.BG));
  });
});

describe("Alert — component token tier", () => {
  const css = readFileSync(resolve(process.cwd(), "src/tailwind.css"), "utf8");

  test("declares every alert token in tailwind.css", () => {
    const missing = ALERT_TOKEN_NAMES.filter((name) => !css.includes(`${componentTokenProperty(name)}:`));
    expect(missing).toEqual([]);
  });

  test("maps every colour alias and every tone to a declared token", () => {
    for (const color of [
      "success", "error", "danger", "warning", "info", "primary", "secondary", "unmapped", undefined,
    ]) {
      const tone = alertTone(color);
      expect(UI_TONES, String(color)).toContain(tone);
      for (const suffix of ALERT_TONE_SUFFIXES) {
        const name = `ui-alert-${tone}-${suffix}`;
        expect(ALERT_TOKEN_NAMES, name).toContain(name);
        expect(css, name).toContain(`${componentTokenProperty(name as (typeof ALERT_TOKEN_NAMES)[number])}:`);
      }
    }
  });

  test("every variant paints from tokens (filled / light / outline / transparent / unset)", () => {
    for (const variant of ["filled", "light", "outline", "transparent", undefined] as const) {
      const { container } = render(() => <Alert variant={variant} color="success" data-testid={`v-${variant}`}>v</Alert>);
      const style = (container.firstElementChild as HTMLElement).getAttribute("style") ?? "";
      expect(style, String(variant)).toMatch(/var\(--ui-alert-/);
    }
  });

  test("every tone keeps a contrast-safe filled ink from pickTextColor", () => {
    for (const tone of UI_TONES) {
      const { container } = render(() => <Alert variant="filled" color={tone}>filled</Alert>);
      const el = container.firstElementChild as HTMLElement;
      // Alert's historical table maps `primary` to INFO, so use the same map.
      const resolved = alertTone(tone);
      expect(el.style.backgroundColor, tone).toBe(`var(--ui-alert-${resolved}-main)`);
      expect(el.style.color, tone).toBe(pickTextColor(TONE_ANCHORS[resolved], palette.TEXT, palette.BG));
    }
  });

  test("raw caller colours keep their own contrast-picked ink", () => {
    for (const color of [palette.PRIMARY, palette.INFO, "rgb(12, 34, 56)"]) {
      const { container } = render(() => <Alert variant="filled" color={color}>raw</Alert>);
      const el = container.firstElementChild as HTMLElement;
      expect(el.style.backgroundColor).toBe(color);
      expect(el.style.color).toBe(pickTextColor(color, palette.TEXT, palette.BG));
    }
  });
});
