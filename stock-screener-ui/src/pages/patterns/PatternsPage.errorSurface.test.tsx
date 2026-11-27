// @vitest-environment happy-dom
// Harness first: its vi.mock registrations must run before PatternsPage loads.
import { makeProps, r, resetHarness, testHooks } from "./PatternsPage.mainHarness";
import { PatternsPage } from "./PatternsPage";

const { afterEach, beforeEach, describe, expect, cleanup, screen } = testHooks;

describe("PatternsPage single error surface and canonical scope copy", () => {
  beforeEach(resetHarness);
  afterEach(() => cleanup());

  test("a failed scan shows the persistent inline alert without a duplicate scope-band toast", () => {
    r(() => (
      <PatternsPage {...makeProps({ results: [], total: 0, error: "Scan failed: boom" })} />
    ));
    expect(screen.getByTestId("patterns-error")).toHaveTextContent("Scan failed: boom");
    expect(screen.queryByTestId("patterns-status-line")).not.toBeInTheDocument();
  });

  test("empty and error helper copy uses the canonical scope label, not the raw universe id", () => {
    const universes = [{ id: "nifty50", label: "NIFTY 50", count: 50 }];
    r(() => (
      <PatternsPage {...makeProps({ universes, universe: "nifty50", results: [], total: 0 })} />
    ));
    const empty = screen.getByTestId("patterns-empty");
    expect(empty).toHaveTextContent("NIFTY 50 · 1D");
    expect(empty).not.toHaveTextContent("nifty50");
  });

  test("error helper copy uses the canonical scope label too", () => {
    const universes = [{ id: "nifty50", label: "NIFTY 50", count: 50 }];
    r(() => (
      <PatternsPage
        {...makeProps({
          universes,
          universe: "nifty50",
          results: [],
          total: 0,
          error: "Scan failed: boom",
        })}
      />
    ));
    const empty = screen.getByTestId("patterns-empty");
    expect(empty).toHaveTextContent("NIFTY 50 · 1D");
    expect(empty).not.toHaveTextContent("nifty50");
  });
});
