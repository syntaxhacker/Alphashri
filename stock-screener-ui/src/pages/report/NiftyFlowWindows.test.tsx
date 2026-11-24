// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import type { JSX } from "solid-js";
import { afterEach, describe, expect, test } from "vitest";
import { UIProvider } from "@/ui";
import type { NiftyReport } from "@/types/niftyReport";
import { NiftyFlowWindows } from "./NiftyFlowWindows";

function report(over: Partial<NiftyReport> = {}): NiftyReport {
  return {
    control: { verdict: "call_buyers", flow_bias: 2656.63, ce_doi: 1, pe_doi: 1, atm_ce_iv: 1, atm_pe_iv: 1, skew: 1, gex_regime: "short" },
    flow_window: {
      as_of: "2026-11-04T11:25:14+05:30",
      "15m": { from: "2026-11-04T11:10:14+05:30", ce: 3_316_105, pe: -852_670, net: 4_168_775 },
      "5m": { from: "2026-11-04T11:20:14+05:30", ce: -952_185, pe: 646_815, net: -1_599_000 },
    },
    ...over,
  } as NiftyReport;
}

function r(jsx: () => JSX.Element) {
  return render(jsx, { wrapper: UIProvider });
}

afterEach(cleanup);

describe("NiftyFlowWindows session units", () => {
  test("a dash-only report still mounts its cells; the parent names WINDOWS in the shared strip", () => {
    r(() => (
      <NiftyFlowWindows
        report={report({ control: { verdict: null, flow_bias: null }, flow_window: null })}
      />
    ));
    expect(screen.getByTestId("flow-session")).toHaveTextContent("—");
    expect(screen.getByTestId("flow-15m")).toHaveTextContent("—");
    expect(screen.getByTestId("flow-5m")).toHaveTextContent("—");
  });

  test("hides the ₹cr amount for a generic underlying but keeps the verdict", () => {
    r(() => <NiftyFlowWindows report={report()} showSessionValue={false} />);
    const session = screen.getByTestId("flow-session");
    expect(session).toHaveTextContent("CALL BUYING");
    expect(session).not.toHaveTextContent("₹");
  });

  test("shows the ₹cr amount by default (NIFTY)", () => {
    r(() => <NiftyFlowWindows report={report()} />);
    expect(screen.getByTestId("flow-session")).toHaveTextContent("₹2,657cr");
  });
});

describe("NiftyFlowWindows", () => {
  test("renders SESSION / 15m / 5m and badges the 5m flip", () => {
    r(() => <NiftyFlowWindows report={report()} />);
    expect(screen.getByTestId("nifty-flow-windows")).toBeInTheDocument();
    expect(screen.getByTestId("flow-session")).toHaveTextContent("CALL BUYING");
    expect(screen.getByTestId("flow-session")).toHaveTextContent("+₹2,657cr");
    expect(screen.getByTestId("flow-15m")).toHaveTextContent("CALL BID");
    expect(screen.getByTestId("flow-5m")).toHaveTextContent("PUT BID");
    expect(screen.getByTestId("flow-flip")).toHaveTextContent("FLOW FLIP since 11:20");
    expect(screen.getByTestId("flow-flip")).toHaveTextContent("5m vs 15m");
  });

  test("aligned legs show ALIGNED instead of a flip", () => {
    r(() => (
      <NiftyFlowWindows
        report={report({
          flow_window: {
            as_of: "2026-11-04T11:25:14+05:30",
            "15m": { from: "", ce: 1, pe: -1, net: 2 },
            "5m": { from: "", ce: 1, pe: -1, net: 2 },
          },
        })}
      />
    ));
    expect(screen.getByTestId("flow-aligned")).toHaveTextContent("ALIGNED");
    expect(screen.queryByTestId("flow-flip")).not.toBeInTheDocument();
  });

  test("aligned legs show the persisted LAST FLIP chip", () => {
    r(() => (
      <NiftyFlowWindows
        report={report({
          flow_window: {
            as_of: "2026-11-04T11:25:14+05:30",
            "15m": { from: "", ce: 1, pe: -1, net: 2 },
            "5m": { from: "", ce: 1, pe: -1, net: 2 },
          },
        })}
        lastFlip={{ at: "2026-11-04T11:28:00+05:30", reason: "5m vs 15m" }}
      />
    ));
    expect(screen.getByTestId("flow-last-flip")).toHaveTextContent("LAST FLOW FLIP 11:28");
  });

  test("a current flip keeps the FLIP badge and never shows LAST FLIP", () => {
    r(() => (
      <NiftyFlowWindows
        report={report()}
        lastFlip={{ at: "2026-11-04T11:28:00+05:30", reason: "5m vs 15m" }}
      />
    ));
    expect(screen.getByTestId("flow-flip")).toBeInTheDocument();
    expect(screen.queryByTestId("flow-last-flip")).not.toBeInTheDocument();
  });

  test("the ? help chip is not a false button: no role=button and no focus stop", () => {
    r(() => <NiftyFlowWindows report={report()} />);
    const chip = screen.getByTestId("flow-legend");
    expect(chip.tagName.toLowerCase()).toBe("span");
    expect(chip).not.toHaveAttribute("role");
    expect(chip).not.toHaveAttribute("tabindex");
  });

  test("the ? help chip still exposes the full rule via aria-label and title", () => {
    r(() => <NiftyFlowWindows report={report()} />);
    const chip = screen.getByTestId("flow-legend");
    expect(chip).toHaveAttribute("aria-label", expect.stringContaining("CALL BID"));
    expect(chip).toHaveAttribute("aria-label", expect.stringContaining("BOTH BUILD"));
    expect(chip).toHaveAttribute("title", expect.stringContaining("CALL BID"));
    expect(chip).toHaveAttribute("title", expect.stringContaining("BOTH BUILD"));
  });
});
