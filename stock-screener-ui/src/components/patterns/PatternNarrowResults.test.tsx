// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/test-utils/solidUiMock");
  return mockSolidUi();
});

import { PatternNarrowResults } from "./PatternNarrowResults";
import { makeIRCONHit } from "./patternTestFixtures";

describe("PatternNarrowResults", () => {
  afterEach(() => cleanup());

  test("puts the pattern, score, position and change on the same row", () => {
    const hit = makeIRCONHit({
      last_close: 114.2,
      day_change_pct: 1.42,
      range_pos: 68,
    });
    render(() => <PatternNarrowResults hits={[hit]} onSelect={vi.fn()} />);

    const row = screen.getByTestId("patterns-narrow-result-IRCON-falling_wedge-1");
    expect(within(row).getByTestId("patterns-narrow-pattern-IRCON-falling_wedge-1")).toHaveTextContent(
      "Falling Wedge",
    );
    expect(within(row).getByTestId("patterns-narrow-score-IRCON-falling_wedge-1")).toHaveTextContent(
      "78.4",
    );
    expect(within(row).getByTestId("patterns-narrow-pos-IRCON-falling_wedge-1")).toHaveTextContent(
      "68%",
    );
    expect(within(row).getByTestId("patterns-narrow-chg-IRCON-falling_wedge-1")).toHaveTextContent(
      "+1.42%",
    );
  });

  test("labels the score and position metrics for assistive tech", () => {
    render(() => <PatternNarrowResults hits={[makeIRCONHit()]} onSelect={vi.fn()} />);
    const score = screen.getByTestId("patterns-narrow-score-IRCON-falling_wedge-1");
    const pos = screen.getByTestId("patterns-narrow-pos-IRCON-falling_wedge-1");
    expect(score.title).toMatch(/confidence/i);
    expect(pos.title).toMatch(/price range/i);
  });

  test("selects the hit from the row", () => {
    const onSelect = vi.fn();
    render(() => <PatternNarrowResults hits={[makeIRCONHit()]} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("patterns-narrow-result-IRCON-falling_wedge-1"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].symbol).toBe("IRCON");
  });
});
