// @vitest-environment happy-dom
// Harness first: its vi.mock registrations must run before PatternsPage loads.
import { makeProps, r, resetHarness, testHooks } from "./PatternsPage.mainHarness";
import { PatternsPage } from "./PatternsPage";

const { afterEach, beforeEach, describe, expect, test, cleanup, fireEvent, screen } = testHooks;

describe("PatternsPage actions and toggles", () => {
  beforeEach(resetHarness);
  afterEach(() => cleanup());

  test("the f shortcut never opens Filters behind an open dialog", async () => {
    r(() => <PatternsPage {...makeProps()} />);
    fireEvent.click(screen.getByTestId("patterns-paste-symbols"));
    expect(await screen.findByTestId("patterns-paste-symbols-input")).toBeInTheDocument();

    // Focus the dialog chrome (not its textarea), then press the page shortcut.
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    dialog.focus();
    fireEvent.keyDown(dialog, { key: "f" });

    expect(screen.queryByTestId("patterns-filter-modal")).not.toBeInTheDocument();
    expect(screen.getByTestId("patterns-paste-symbols-input")).toBeInTheDocument();
  });

  test("scan again triggers scan", async () => {
    const props = makeProps();
    r(() => <PatternsPage {...props} />);
    fireEvent.click(screen.getByTestId("patterns-scan-again"));
    expect(props.scan).toHaveBeenCalledTimes(1);
  });
});
