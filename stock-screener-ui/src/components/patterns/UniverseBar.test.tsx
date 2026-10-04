// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import type { Universe } from "@/types/chartPatterns";
import { UniverseBar, type UniverseBarProps } from "./UniverseBar";

const UNIVERSES: Universe[] = [
  { id: "universe", label: "Universe scan", count: 9700 },
  { id: "nifty50", label: "Nifty 50", count: 50 },
  { id: "nifty500", label: "Nifty 500", count: 500 },
];

function makeProps(overrides: Partial<UniverseBarProps> = {}): UniverseBarProps {
  return {
    universes: UNIVERSES,
    universe: "nifty50",
    setUniverse: vi.fn(),
    scan: vi.fn(),
    scanning: false,
    job: null,
    queuePosition: null,
    error: null,
    ...overrides,
  };
}

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> });
}

describe("UniverseBar", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  test("renders a pill per universe", () => {
    r(<UniverseBar {...makeProps()} />);
    expect(screen.getByTestId("patterns-universe-bar")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-universe-universe")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-universe-nifty50")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-universe-nifty500")).toBeInTheDocument();
  });

  test("selecting a universe pill calls setUniverse", async () => {
    const props = makeProps();
    r(<UniverseBar {...props} />);
    await userEvent.click(screen.getByTestId("patterns-universe-nifty500"));
    expect(props.setUniverse).toHaveBeenCalledWith("nifty500");
  });

  test("scan again triggers scan and disables while scanning", async () => {
    const props = makeProps({ scanning: true });
    r(<UniverseBar {...props} />);
    const button = screen.getByTestId("patterns-scan-again");
    expect(button).toBeDisabled();
  });

  test("shows the error status line", () => {
    r(<UniverseBar {...makeProps({ error: "Queue is full" })} />);
    expect(screen.getByTestId("patterns-status-line")).toHaveTextContent("Queue is full");
  });

  test("renders the custom pill and selects the custom scope", async () => {
    const props = makeProps({ customUniverse: "custom" });
    r(<UniverseBar {...props} />);
    await userEvent.click(screen.getByTestId("patterns-universe-custom"));
    expect(props.setUniverse).toHaveBeenCalledWith("custom");
  });

  test("labels the scan action with the custom symbol count", () => {
    r(
      <UniverseBar
        {...makeProps({ universe: "custom", customUniverse: "custom", customSymbolCount: 3 })}
      />,
    );
    expect(screen.getByTestId("patterns-scan-again")).toHaveTextContent("Scan 3 symbols");
  });

  test("disables the scan action for an empty custom scope", () => {
    r(
      <UniverseBar
        {...makeProps({ universe: "custom", customUniverse: "custom", customSymbolCount: 0 })}
      />,
    );
    expect(screen.getByTestId("patterns-scan-again")).toBeDisabled();
  });
});
