// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";

import { afterEach, describe, expect, test } from "vitest";
import { cleanup, screen } from "@solidjs/testing-library";
import { NiftyFlowStrip } from "./NiftyFlowStrip";
import { base, maxPainStaircase } from "./niftyFlowStrip.fixtures";
import { hm, r } from "./reportTestFixtures";

afterEach(() => {
  cleanup();
});

describe("NiftyFlowStrip interactions and states", () => {
  test("hover titles carry time and label", () => {
    const rows = [base({ t: hm(0) }), base({ t: hm(1), put_doi: 2_500_000 })];
    r(() => <NiftyFlowStrip {...{ rows: rows }} />);
    const tick = screen.getByTestId("nifty-flow-tick");
    expect(tick.getAttribute("title")).toContain(hm(1));
  });

  test("overflow folds older runs into a +N earlier marker", () => {
    r(() => <NiftyFlowStrip {...{ rows: maxPainStaircase(5), maxLabels: 2 }} />);
    expect(screen.getAllByTestId("nifty-flow-label")).toHaveLength(2);
    expect(screen.getByTestId("nifty-flowstrip-more")).toHaveTextContent("+3 earlier");
  });

  test("an empty tape is a compact one-line reason, not a full empty band", () => {
    r(() => <NiftyFlowStrip {...{ rows: [base({ t: hm(0) }), base({ t: hm(1) })] }} />);
    const empty = screen.getByTestId("nifty-flowstrip-empty");
    expect(empty).toHaveAttribute("data-state", "unavailable");
    expect(empty.className).toContain("h-5");
    expect(empty.className).toContain("text-ui-micro");
    expect(screen.getByTestId("nifty-flowstrip-empty-text")).toHaveTextContent("no flow prints · live only");
    expect(screen.queryByTestId("nifty-flowstrip")).toBeNull();
  });
});
