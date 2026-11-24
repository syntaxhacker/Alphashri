// @vitest-environment happy-dom
// Harness first: its vi.mock registrations must run before PatternsPage loads.
import { makeProps, r, resetHarness, testHooks } from "./PatternsPage.mainHarness";
import { PatternsPage } from "./PatternsPage";

const { afterEach, beforeEach, describe, expect, test, cleanup, fireEvent, screen } = testHooks;

describe("PatternsPage", () => {
  beforeEach(resetHarness);
  afterEach(() => cleanup());

  test("a null hit click does not throw", () => {
    r(() => <PatternsPage {...makeProps()} />);
    expect(() =>
      fireEvent.click(screen.getByTestId("patterns-list-select-null")),
    ).not.toThrow();
  });
});
