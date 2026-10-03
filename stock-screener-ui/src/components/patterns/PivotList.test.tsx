// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import { PivotList } from "./PatternPivotList";

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> });
}

afterEach(() => cleanup());

describe("PivotList", () => {
  test("renders nothing without pivots", () => {
    const { container } = r(<PivotList pivots={[]} />);
    expect(container.querySelector('[data-testid="patterns-detail-pivots"]')).toBeNull();
  });

  test("lists each pivot with readable date, price and kind", () => {
    r(
      <PivotList
        pivots={[
          { t: "2026-05-04", price: 1234.5, kind: "high" },
          { t: "2026-05-20", price: 1180, kind: "low" },
        ]}
      />,
    );
    expect(screen.getByTestId("patterns-detail-pivot-0")).toHaveTextContent("04 May 2026 · ₹1234.50 · High");
    expect(screen.getByTestId("patterns-detail-pivot-1")).toHaveTextContent("20 May 2026 · ₹1180.00 · Low");
    expect(screen.getByTestId("patterns-detail-pivots")).toHaveTextContent("(2)");
  });

  test("is collapsed by default and toggles open", async () => {
    const user = userEvent.setup();
    r(<PivotList pivots={[{ t: "2026-05-04", price: 100, kind: "low" }]} />);
    const toggle = screen.getByTestId("patterns-detail-pivots-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });
});
