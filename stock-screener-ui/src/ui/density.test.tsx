// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import {
  DensityProvider,
  useDensity,
  setDensity,
  getStoredDensity,
  DENSITY_TOKENS,
  DENSITY_STORAGE_KEY,
  TABLE_ROW_PY_VAR,
} from "./density";

afterEach(() => {
  cleanup();
  localStorage.removeItem(DENSITY_STORAGE_KEY);
  act(() => {
    setDensity("compact");
  });
});

function DensityReader() {
  const { density, tokens } = useDensity();
  return (
    <div data-testid="density-reader" data-density={density} data-row-height={tokens.tableRowHeight}>
      {density}
    </div>
  );
}

describe("density", () => {
  it("defaults to compact (identical to pre-density styling)", () => {
    render(<DensityReader />);
    expect(screen.getByTestId("density-reader")).toHaveAttribute("data-density", "compact");
    expect(DENSITY_TOKENS.compact.tableCellPad).toBe("3px 8px");
    expect(DENSITY_TOKENS.compact.tableRowHeight).toBe(20);
    expect(DENSITY_TOKENS.compact.panelPad).toBe(1);
    expect(DENSITY_TOKENS.compact.statPad).toBe(1);
  });

  it("persists the choice to localStorage and mirrors the CSS var", () => {
    render(<DensityReader />);
    act(() => {
      setDensity("comfortable");
    });
    expect(screen.getByTestId("density-reader")).toHaveAttribute("data-density", "comfortable");
    expect(localStorage.getItem(DENSITY_STORAGE_KEY)).toBe("comfortable");
    expect(document.documentElement.style.getPropertyValue(TABLE_ROW_PY_VAR)).toBe("6px");
    expect(getStoredDensity()).toBe("comfortable");
  });

  it("comfortable tokens are roomier than compact", () => {
    expect(DENSITY_TOKENS.comfortable.tableRowHeight).toBeGreaterThan(
      DENSITY_TOKENS.compact.tableRowHeight,
    );
    expect(DENSITY_TOKENS.comfortable.panelPad).toBeGreaterThan(DENSITY_TOKENS.compact.panelPad);
  });

  it("DensityProvider value overrides the subtree and restores on unmount", () => {
    const { unmount } = render(
      <DensityProvider value="comfortable">
        <DensityReader />
      </DensityProvider>,
    );
    expect(screen.getByTestId("density-reader")).toHaveAttribute("data-density", "comfortable");
    unmount();
    expect(getStoredDensity()).toBe("compact");
  });

  it("ignores invalid stored values", () => {
    localStorage.setItem(DENSITY_STORAGE_KEY, "cozy");
    expect(getStoredDensity()).toBe("compact");
  });
});
