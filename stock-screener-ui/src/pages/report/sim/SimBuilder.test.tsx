// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SimStrategySpec } from "@/types/reportSim";
import { newStrategy } from "./simSpec";
import { SimBuilder } from "./SimBuilder";

const LADDER = [24800, 24850, 24900, 24950, 25000];
const SPOT = 24900;

function spec(overrides: Partial<SimStrategySpec> = {}): SimStrategySpec {
  return { ...newStrategy(1, "long-call"), ...overrides };
}

function renderBuilder(
  strategy: SimStrategySpec,
  onChange = vi.fn(),
  errors: string[] = [],
) {
  const view = render(
    <SimBuilder
      strategy={strategy}
      ladder={LADDER}
      spot={SPOT}
      errors={errors}
      onChange={onChange}
    />,
  );
  return { ...view, onChange };
}

/** NumberInput puts its testid on the FormControl, so reach the native input. */
function numberField(testId: string): HTMLInputElement {
  const input = screen.getByTestId(testId).querySelector("input");
  if (!input) throw new Error(`No input inside ${testId}`);
  return input;
}

describe("SimBuilder", () => {
  test("renders the long-call leg with its resolved strike", () => {
    renderBuilder(spec());
    expect(screen.getByTestId("sim-leg-0")).toBeInTheDocument();
    expect(screen.getByTestId("sim-leg-0-strike")).toHaveValue("ATM");
    expect(screen.getByTestId("sim-leg-0-resolved")).toHaveTextContent("24900");
    expect(screen.getByTestId("sim-structure")).toHaveTextContent("Single leg");
  });

  test("adds a second leg and re-renders it", async () => {
    const user = userEvent.setup();
    const initial = spec();
    const { rerender, onChange } = renderBuilder(initial);

    await user.click(screen.getByTestId("sim-add-leg"));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as SimStrategySpec;
    expect(next.legs).toHaveLength(2);

    rerender(
      <SimBuilder
        strategy={next}
        ladder={LADDER}
        spot={SPOT}
        errors={[]}
        onChange={onChange}
      />,
    );
    expect(screen.getByTestId("sim-leg-1")).toBeInTheDocument();
  });

  test("edits lots through the number input", () => {
    const { onChange } = renderBuilder(spec());

    fireEvent.change(numberField("sim-leg-0-lots"), {
      target: { value: "3" },
    });

    const next = onChange.mock.calls.at(-1)?.[0] as SimStrategySpec;
    expect(next.legs[0].lots).toBe(3);
  });

  test("edits the execution row", () => {
    const { onChange } = renderBuilder(spec());

    fireEvent.change(numberField("sim-sl"), { target: { value: "25" } });

    const next = onChange.mock.calls.at(-1)?.[0] as SimStrategySpec;
    expect(next.exec.slPct).toBe(25);
  });

  test("shows validation errors supplied by the caller", () => {
    renderBuilder(spec(), vi.fn(), [
      "Add at least one leg.",
      "Leg 1: strike is required.",
    ]);
    const alert = screen.getByTestId("sim-errors");
    expect(alert).toHaveTextContent("Add at least one leg.");
    expect(alert).toHaveTextContent("Leg 1: strike is required.");
  });

  test("shows no alert when there are no errors", () => {
    renderBuilder(spec());
    expect(screen.queryByTestId("sim-errors")).not.toBeInTheDocument();
  });
});
