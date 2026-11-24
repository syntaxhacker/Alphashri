// @vitest-environment happy-dom
// Harness first: its vi.mock registrations must run before PatternsPage loads.
import { makeProps, r, resetHarness, testHooks } from "./PatternsPage.mainHarness";
import { PatternsPage } from "./PatternsPage";

const { afterEach, beforeEach, describe, expect, test, cleanup, fireEvent, screen } = testHooks;

describe("PatternsPage empty and error states", () => {
  beforeEach(resetHarness);
  afterEach(() => cleanup());

  test("an empty custom scope cannot launch a scan from the empty state", () => {
    r(() => (
      <PatternsPage
        {...makeProps({
          universe: "custom",
          customUniverse: "custom",
          results: [],
          total: 0,
          loading: false,
        })}
      />
    ));
    expect(screen.getByTestId("patterns-empty-scan")).toBeDisabled();
    expect(screen.getByText(/Custom scope is empty/i)).toBeInTheDocument();
  });

  test("empty state copy is plain prose, not code identifiers", () => {
    r(() => <PatternsPage {...makeProps({ results: [], total: 0 })} />);
    const empty = screen.getByTestId("patterns-empty");
    expect(empty).toHaveTextContent("No patterns match the current filters.");
    expect(empty).not.toHaveTextContent("patterns()");
    expect(empty).not.toHaveTextContent("filters()");
  });

  test("shows empty state with refresh action", async () => {
    const props = makeProps({ results: [], total: 0 });
    r(() => <PatternsPage {...props} />);
    expect(screen.getByTestId("patterns-empty")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(props.refresh).toHaveBeenCalledTimes(1);
  });

  test("empty state offers a scan CTA for the current universe/timeframe", async () => {
    const props = makeProps({ results: [], total: 0, timeframe: "15m", universe: "nifty500" });
    r(() => <PatternsPage {...props} />);
    const cta = screen.getByTestId("patterns-empty-scan");
    expect(cta).toHaveTextContent("Scan 15m now");
    expect(screen.getByTestId("patterns-empty")).toHaveTextContent("nifty500 · 15m");
    fireEvent.click(cta);
    expect(props.scan).toHaveBeenCalledTimes(1);
  });

  test("shows the error alert instead of the generic empty copy when error is set", () => {
    r(() => <PatternsPage {...makeProps({ results: [], total: 0, error: "Scan failed: boom" })} />);
    expect(screen.getByTestId("patterns-error")).toHaveTextContent("Scan failed: boom");
    expect(screen.getByTestId("patterns-empty")).toBeInTheDocument();
  });
});
