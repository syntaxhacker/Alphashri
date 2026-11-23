import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, test } from "vitest";
import { setLiveTick } from "./niftyStreamSolid";
import { ContextCell, DecisionCell, DecisionChip, NiftySpotValue } from "./reportCells";

afterEach(() => {
  setLiveTick(null);
  cleanup();
});

describe("decision strip cells", () => {
  test("DecisionCell repaints when the value prop changes", () => {
    const [value, setValue] = createSignal<string>("25,700");
    render(() => (
      <DecisionCell
        testId="decision-spot"
        label="SPOT"
        value={value()}
        hint="live last price"
        valueSize={15}
      />
    ));

    expect(screen.getByTestId("decision-spot")).toHaveTextContent("SPOT");
    expect(screen.getByTestId("decision-spot-value")).toHaveTextContent("25,700");
    expect(screen.getByTestId("decision-spot")).toHaveAttribute(
      "title",
      "SPOT: live last price",
    );

    setValue("25,750.35");
    expect(screen.getByTestId("decision-spot-value")).toHaveTextContent("25,750.35");
    expect(screen.getByTestId("decision-spot-value")).not.toHaveTextContent("25,700");
  });

  test("DecisionCell honours the accent and the explicit title", () => {
    render(() => (
      <DecisionCell
        testId="decision-gex"
        label="GEX FLIP"
        value="25,642"
        hint="zero gamma"
        title="Gamma flip"
        accent="#FF8A3D"
      />
    ));

    expect(screen.getByTestId("decision-gex")).toHaveAttribute(
      "title",
      "Gamma flip — zero gamma",
    );
    expect(screen.getByTestId("decision-gex-value")).toHaveStyle({ color: "#FF8A3D" });
  });

  test("ContextCell repaints when the value prop changes", () => {
    const [value, setValue] = createSignal<string>("1.08");
    render(() => <ContextCell testId="context-pcr" label="PCR" value={value()} />);

    expect(screen.getByTestId("context-pcr")).toHaveTextContent("PCR");
    expect(screen.getByTestId("context-pcr")).toHaveTextContent("1.08");

    setValue("1.12");
    expect(screen.getByTestId("context-pcr")).toHaveTextContent("1.12");
    expect(screen.getByTestId("context-pcr")).not.toHaveTextContent("1.08");
  });

  test("DecisionChip repaints its value and keeps the click handler", () => {
    const [value, setValue] = createSignal<string>("+2.4");
    let clicks = 0;
    render(() => (
      <DecisionChip
        testId="chip-flow"
        label="FLOW"
        value={value()}
        tone="#00C98D"
        onClick={() => {
          clicks += 1;
        }}
      />
    ));

    expect(screen.getByTestId("chip-flow")).toHaveTextContent("FLOW");
    expect(screen.getByTestId("chip-flow")).toHaveTextContent("+2.4");

    setValue("-1.9");
    expect(screen.getByTestId("chip-flow")).toHaveTextContent("-1.9");
    expect(screen.getByTestId("chip-flow")).not.toHaveTextContent("+2.4");

    fireEvent.click(screen.getByTestId("chip-flow"));
    expect(clicks).toBe(1);
  });
});

describe("NiftySpotValue", () => {
  test("follows the live tick and falls back to the report spot", () => {
    setLiveTick(null);
    const [live, setLive] = createSignal(false);
    const { container } = render(() => (
      <NiftySpotValue live={live()} fallback={25000} />
    ));

    expect(container.textContent).toBe("25,000");

    setLive(true);
    setLiveTick({ spot: 25123.45, ts: null, change_pct: 0.5 });
    expect(container.textContent).toBe("25,123.45");

    setLiveTick({ spot: 25201.5, ts: null, change_pct: 0.8 });
    expect(container.textContent).toBe("25,201.5");
    expect(container.textContent).not.toBe("25,123.45");
  });

  test("a second render with different props shows the new fallback", () => {
    const [fallback, setFallback] = createSignal(24800);
    const { container } = render(() => (
      <NiftySpotValue live={false} fallback={fallback()} />
    ));

    expect(container.textContent).toBe("24,800");

    setFallback(24975.5);
    expect(container.textContent).toBe("24,975.5");
    expect(container.textContent).not.toBe("24,800");
  });
});
