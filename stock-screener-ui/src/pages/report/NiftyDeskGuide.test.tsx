// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@solidjs/testing-library";
import type { JSX } from "solid-js";
import { UIProvider } from "@/ui";
import { DESK_GUIDE_ENTRIES, NiftyDeskGuide } from "./NiftyDeskGuide";

const HINT_KEY = "alphashri:desk-guide-hint-dismissed";

function r(node: () => JSX.Element) {
  return render(node, { wrapper: UIProvider });
}

afterEach(() => {
  window.localStorage.removeItem(HINT_KEY);
});

describe("NiftyDeskGuide", () => {
  test("the ? button opens the guide and every glossary heading renders", async () => {
        r(() => <NiftyDeskGuide />);

    const button = screen.getByTestId("nifty-help-button");
    expect(button).toHaveAttribute("title", "Desk guide");
    expect(button).toHaveAttribute("aria-label", "Desk guide");

    fireEvent.click(button);

    expect(screen.getByTestId("panel-modal-title")).toHaveTextContent(
      "Desk guide — read this once",
    );
    expect(screen.getByTestId("panel-modal")).toHaveAttribute("data-compact", "true");
    const modal = screen.getByTestId("nifty-help-modal");
    expect(modal).toHaveClass("grid", "gap-2");
    for (const entry of DESK_GUIDE_ENTRIES) {
      expect(within(modal).getByText(entry.term)).toBeInTheDocument();
    }
    // Fourteen sections from the desk legend, in one dense 3-column grid.
    expect(DESK_GUIDE_ENTRIES).toHaveLength(14);
    expect(within(modal).getByText("COIL / NORMAL / EXPANDING")).toBeInTheDocument();
    expect(within(modal).getByText("HEATMAP")).toBeInTheDocument();
    expect(within(modal).getByText("GAMMA (Γ)")).toBeInTheDocument();
    expect(within(modal).getByText("MAX PAIN")).toBeInTheDocument();
    expect(within(modal).getByText("PIN RISK")).toBeInTheDocument();
    expect(within(modal).getByText("PCR")).toBeInTheDocument();
    expect(within(modal).getByText("SB / LB")).toBeInTheDocument();
    expect(within(modal).getByText("FLOW STRIP")).toBeInTheDocument();
    expect(within(modal).getByText("CAS")).toBeInTheDocument();
    expect(within(modal).getByText("COSTS")).toBeInTheDocument();
  });

  test("PIN RISK explains the pin, the sweep-and-revert and the close-beyond confirmation", () => {
    const pin = DESK_GUIDE_ENTRIES.find((entry) => entry.term === "PIN RISK");
    expect(pin).toBeDefined();
    expect(pin?.text).toMatch(/heavy OI wall/i);
    expect(pin?.text).toMatch(/max pain ≥100 pts/i);
    expect(pin?.text).toMatch(/sweep and revert/i);
    expect(pin?.text).toMatch(/two consecutive 1-min closes/i);
    const terms = DESK_GUIDE_ENTRIES.map((entry) => entry.term);
    expect(terms.indexOf("PIN RISK")).toBe(terms.indexOf("MAX PAIN") + 1);
    expect(terms.indexOf("PIN RISK")).toBeLessThan(terms.indexOf("PCR"));
  });

  test("glossary covers CE/PE, OI/ΔOI, RV vs IV, RSI and keeps MAX PAIN → PIN RISK → PCR adjacency", async () => {
    window.localStorage.removeItem(HINT_KEY);
    r(() => <NiftyDeskGuide />);

    fireEvent.click(screen.getByTestId("nifty-help-button"));
    const modal = screen.getByTestId("nifty-help-modal");
    const terms = DESK_GUIDE_ENTRIES.map((entry) => entry.term);

    expect(DESK_GUIDE_ENTRIES).toHaveLength(14);
    for (const term of ["CE / PE", "OI / ΔOI", "RV vs IV", "RSI"]) {
      expect(terms).toContain(term);
      expect(within(modal).getByText(term)).toBeInTheDocument();
      const entry = DESK_GUIDE_ENTRIES.find((candidate) => candidate.term === term);
      expect(entry?.text.length).toBeGreaterThan(40);
      // A replay or a closed market must not turn a definition into a live claim.
      expect(entry?.text).not.toMatch(/\blive\b|right now|currently/i);
    }
    expect(
      DESK_GUIDE_ENTRIES.find((entry) => entry.term === "RSI")?.text,
    ).toMatch(/momentum/i);
    expect(
      DESK_GUIDE_ENTRIES.find((entry) => entry.term === "OI / ΔOI")?.text,
    ).toMatch(/contracts still open/i);
    expect(terms.indexOf("PIN RISK")).toBe(terms.indexOf("MAX PAIN") + 1);
    expect(terms.indexOf("PCR")).toBe(terms.indexOf("PIN RISK") + 1);

    // The modal body owns scrolling: 14 entries stay reachable at 1600 and 390,
    // where the grid collapses from three columns to one.
    expect(screen.getByTestId("panel-modal-body")).toHaveStyle({ overflow: "auto" });
    expect(modal).toHaveClass("grid-cols-[minmax(0,1fr)]");
    expect(modal).toHaveClass("min-[900px]:grid-cols-[repeat(3,minmax(0,1fr))]");

    expect(screen.getByTestId("nifty-guide-first-run-hint")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("nifty-guide-first-run-hint-dismiss"));
    await waitFor(() =>
      expect(screen.queryByTestId("nifty-guide-first-run-hint")).not.toBeInTheDocument(),
    );
    expect(window.localStorage.getItem(HINT_KEY)).toBe("1");
    expect(within(modal).getByText("RSI")).toBeInTheDocument();
  });

  test("a dismissed first-run hint stays hidden on a fresh mount", () => {
    window.localStorage.setItem(HINT_KEY, "1");
    r(() => <NiftyDeskGuide />);

    fireEvent.click(screen.getByTestId("nifty-help-button"));
    expect(screen.getByTestId("nifty-help-modal")).toBeInTheDocument();
    expect(screen.queryByTestId("nifty-guide-first-run-hint")).not.toBeInTheDocument();
  });

  test("the close X dismisses the guide", async () => {
        r(() => <NiftyDeskGuide />);

    fireEvent.click(screen.getByTestId("nifty-help-button"));
    expect(screen.getByTestId("nifty-help-modal")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("panel-modal-close"));
    await waitFor(() =>
      expect(screen.queryByTestId("nifty-help-modal")).not.toBeInTheDocument(),
    );
  });
});
