// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { MetricCell } from "./MetricCell";

afterEach(cleanup);

function cell(tone?: "positive" | "negative" | "warning" | "info" | "neutral") {
  return (
    <UIProvider>
      <MetricCell label="ATM IV" value="12.4" testId="atm-iv" tone={tone} />
    </UIProvider>
  );
}

describe("MetricCell", () => {
  test("stacks the label over the value with the shared testids", () => {
    render(() => cell());
    const wrapper = screen.getByTestId("atm-iv");
    expect(wrapper.children).toHaveLength(2);
    expect(wrapper.children[0]).toHaveTextContent("ATM IV");
    expect(screen.getByTestId("atm-iv-value")).toHaveTextContent("12.4");
  });

  test("label is 9px uppercase and value is 10px mono tabular", () => {
    render(() => cell());
    const label = screen.getByTestId("atm-iv").children[0] as HTMLElement;
    const value = screen.getByTestId("atm-iv-value");

    expect(label.className).toContain("uppercase");
    expect(label.style.fontSize).toBe("9px");
    expect(value.className).toContain("font-mono");
    expect(value.className).toContain("tabular-nums");
    expect(value.style.fontSize).toBe("10px");
  });

  test("tone resolves to a semantic CSS variable, not a hardcoded hex", () => {
    render(() => cell("positive"));
    expect(screen.getByTestId("atm-iv-value").style.color).toBe("var(--color-fin-positive)");
  });

  test("no tone leaves the value colour to the theme", () => {
    render(() => cell());
    expect(screen.getByTestId("atm-iv-value").style.color).toBe("");
  });
});
