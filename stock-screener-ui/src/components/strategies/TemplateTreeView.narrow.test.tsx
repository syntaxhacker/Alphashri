// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import { TemplateTreeView } from "./TemplateTreeView";
import type { StrategyConfig } from "../../types/strategies";

function stubMatchMedia(narrow: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: narrow && query.includes("max-width: 899px"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

const template = {
  id: "tpl-1", internal_id: 1, name: "ORB Template", strategy_type: "ORB",
  parent_id: null, sl_pct: 0.4, tp_pct: 1.2, max_positions: 5,
} as unknown as StrategyConfig;

const variation = {
  ...template,
  id: "var-2", internal_id: 2, name: "ORB Variation", strategy_type: "",
  parent_id: 1, sl_pct: 0.6, tp_pct: 2, max_positions: 3,
} as unknown as StrategyConfig;

function renderTree() {
  return render(() => (
    <UIProvider>
      <TemplateTreeView
        templates={[template]}
        strategies={[variation]}
        onEditTemplate={vi.fn()}
        onSyncVariations={vi.fn()}
        onCreateFromTemplate={vi.fn()}
        onEditStrategy={vi.fn()}
        onDeleteStrategy={vi.fn()}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
        isLoading={false}
      />
    </UIProvider>
  ));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TemplateTreeView layout split at 900px", () => {
  it("keeps one ordered, right-aligned header on desktop", () => {
    stubMatchMedia(false);
    renderTree();
    const header = screen.getByTestId("strategy-tree-header");
    expect(Array.from(header.children).map((el) => el.textContent)).toEqual([
      "Name", "Type", "SL%", "TP%", "MaxPos", "Actions",
    ]);
    for (const label of ["SL%", "TP%", "MaxPos", "Actions"]) {
      expect(screen.getByText(label).getAttribute("style")).toContain("justify-content: flex-end");
    }
    expect(screen.queryByTestId("strategy-tree-narrow")).toBeNull();
    expect(screen.getByTestId("strategy-row-1")).toBeInTheDocument();
  });

  it("renders labeled cards at 390 so no field is blank or off-screen", () => {
    stubMatchMedia(true);
    renderTree();
    expect(screen.getByTestId("strategy-tree-narrow")).toBeInTheDocument();
    expect(screen.queryByTestId("strategy-tree-header")).toBeNull();

    for (const id of [1, 2]) {
      const card = screen.getByTestId(`strategy-tree-card-${id}`);
      for (const label of ["SL%", "TP%", "MaxPos"]) {
        expect(card).toHaveTextContent(label);
      }
      expect(card.querySelector(".grid")).not.toBeNull();
      expect(card).not.toHaveTextContent(/^$/);
    }

    // A variation without its own type inherits the template type; never blank.
    expect(screen.getByTestId("strategy-tree-card-2")).toHaveTextContent("ORB");
    for (const testId of [
      "editable-sl_pct-1", "editable-tp_pct-1", "editable-max_positions-1",
      "edit-template-btn-1", "sync-variations-btn-1", "create-variation-btn-1",
      "edit-strategy-btn-2", "delete-strategy-btn-2",
    ]) {
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    }
  });
});
