// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { UIProvider } from "@/ui";
import { TemplateTreeView, buildStrategyTreeIndex } from "./TemplateTreeView";
import type { StrategyConfig } from "../../types/strategies";

afterEach(() => {
  cleanup();

  vi.clearAllMocks();
  vi.restoreAllMocks();
});

const makeTemplate = (id: number, overrides: Partial<StrategyConfig> = {}): StrategyConfig => ({
  id: String(id), internal_id: id, name: `Template ${id}`, strategy_type: "ORB",
  parent_id: null, is_template: true, is_active: true, is_default: true,
  description: null, or_minutes: 15, sl_pct: 1.0, tp_pct: 1.5,
  min_or_range_pct: 0.3, max_or_range_pct: 2.0, max_positions: 3,
  max_capital_per_trade_pct: 20, max_daily_loss_pct: 5,
  max_total_exposure_pct: 50, risk_per_trade_pct: 2,
  min_trade_value: 5000, max_trade_value: 100000,
  cooldown_minutes: 30, max_distance_from_or_pct: 1.5,
  entry_threshold_pct: 3, enable_trailing_stop: false,
  trailing_stop_pct: 3, trailing_activation_pct: 2,
  max_holding_days: 30, cooldown_days: 30, enable_filters: false,
  ema_fast_period: 9, ema_slow_period: 21,
  pivot_type: "classic", breakout_buffer_pct: 0.1,
  screener_profiles: [],
  brokerage_pct: 0.03, min_brokerage: 20, stt_pct: 0.025,
  exchange_pct: 0.003, sebi_pct: 0.0001, stamp_pct: 0.003,
  gst_pct: 18, created_at: null, updated_at: null,
  ...overrides,
});

const makeVariation = (id: number, parentId: number, overrides: Partial<StrategyConfig> = {}): StrategyConfig => ({
  ...makeTemplate(id),
  internal_id: id,
  name: `Variation ${id}`,
  parent_id: parentId,
  is_template: false,
  ...overrides,
});

describe("TemplateTreeView", () => {
  it("shows loading state when isLoading and no templates", () => {
    render(() => (
      <UIProvider>
        <TemplateTreeView
          templates={[]}
          strategies={[]}
          onEditTemplate={vi.fn()}
          onSyncVariations={vi.fn()}
          onCreateFromTemplate={vi.fn()}
          onEditStrategy={vi.fn()}
          onDeleteStrategy={vi.fn()}
          onUpdate={vi.fn().mockResolvedValue(undefined)}
          isLoading={true}
        />
      </UIProvider>
    ));
    expect(screen.getByTestId("template-tree-loading")).toBeInTheDocument();
  });

  it("shows empty state when no templates (and not loading)", () => {
    render(() => (
      <UIProvider>
        <TemplateTreeView
          templates={[]}
          strategies={[]}
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
    expect(screen.getByTestId("template-tree-empty")).toBeInTheDocument();
  });

  it("renders tree panel with data-testid", () => {
    const templates = [makeTemplate(1)];
    render(() => (
      <UIProvider>
        <TemplateTreeView
          templates={templates}
          strategies={[]}
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
    expect(screen.getByTestId("template-tree-panel")).toBeInTheDocument();
  });

  it("renders column headers: Name, Type, SL%, TP%, MaxPos, Actions", () => {
    const templates = [makeTemplate(1)];
    render(() => (
      <UIProvider>
        <TemplateTreeView
          templates={templates}
          strategies={[]}
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
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Type")).toBeInTheDocument();
    expect(screen.getByText("SL%")).toBeInTheDocument();
    expect(screen.getByText("TP%")).toBeInTheDocument();
    expect(screen.getByText("MaxPos")).toBeInTheDocument();
    expect(screen.getByText("Actions")).toBeInTheDocument();
  });

  it("renders template nodes with their names", () => {
    const templates = [makeTemplate(1, { name: "ORB Template" })];
    render(() => (
      <UIProvider>
        <TemplateTreeView
          templates={templates}
          strategies={[]}
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
    expect(screen.getByText("ORB Template")).toBeInTheDocument();
  });

  it("renders strategy type badge for template nodes", () => {
    const templates = [makeTemplate(1, { strategy_type: "ORB" })];
    render(() => (
      <UIProvider>
        <TemplateTreeView
          templates={templates}
          strategies={[]}
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
    expect(screen.getByText("ORB")).toBeInTheDocument();
  });

  it("renders edit template button for templates", () => {
    const templates = [makeTemplate(1)];
    render(() => (
      <UIProvider>
        <TemplateTreeView
          templates={templates}
          strategies={[]}
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
    expect(screen.getByTestId("edit-template-btn-1")).toBeInTheDocument();
  });

  it("renders edit strategy button for variations", () => {
    const templates = [makeTemplate(1)];
    const variations = [makeVariation(2, 1)];
    render(() => (
      <UIProvider>
        <TemplateTreeView
          templates={templates}
          strategies={variations}
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
    expect(screen.getByTestId("edit-strategy-btn-2")).toBeInTheDocument();
  });

  it("renders delete strategy button for variations", () => {
    const templates = [makeTemplate(1)];
    const variations = [makeVariation(2, 1)];
    render(() => (
      <UIProvider>
        <TemplateTreeView
          templates={templates}
          strategies={variations}
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
    expect(screen.getByTestId("delete-strategy-btn-2")).toBeInTheDocument();
  });

  it("edit template button calls onEditTemplate", () => {
    const onEditTemplate = vi.fn();
    const templates = [makeTemplate(1)];
    render(() => (
      <UIProvider>
        <TemplateTreeView
          templates={templates}
          strategies={[]}
          onEditTemplate={onEditTemplate}
          onSyncVariations={vi.fn()}
          onCreateFromTemplate={vi.fn()}
          onEditStrategy={vi.fn()}
          onDeleteStrategy={vi.fn()}
          onUpdate={vi.fn().mockResolvedValue(undefined)}
          isLoading={false}
        />
      </UIProvider>
    ));
    fireEvent.click(screen.getByTestId("edit-template-btn-1"));
    expect(onEditTemplate).toHaveBeenCalled();
  });

  it("builds the node/variation index in one pass, not once per template", () => {
    const templateCount = 20;
    const strategyCount = 100;
    const templates = Array.from({ length: templateCount }, (_, i) => makeTemplate(i + 1));
    let parentIdReads = 0;
    const variations = Array.from({ length: strategyCount }, (_, i) => {
      const parentId = (i % templateCount) + 1;
      const variation = makeVariation(templateCount + i + 1, parentId);
      Object.defineProperty(variation, "parent_id", {
        configurable: true,
        get() {
          parentIdReads++;
          return parentId;
        },
      });
      return variation;
    });

    const { nodeMap, variationsByParent } = buildStrategyTreeIndex(templates, variations);

    // O(T*S) filtering would read parent_id 20*100 = 2000 times. A single pass
    // reads it exactly once per strategy.
    expect(parentIdReads).toBe(strategyCount);
    expect(nodeMap.size).toBe(templateCount + strategyCount);
    expect(variationsByParent.get("1")).toHaveLength(strategyCount / templateCount);
    expect(variationsByParent.get("999")).toBeUndefined();
  });

  it("groups variations by parent using the internal_id ?? id fallback", () => {
    const template = makeTemplate(7, { internal_id: undefined });
    const numericParent = makeVariation(70, 7);
    const stringParent = makeVariation(71, "7" as unknown as number);

    const { nodeMap, variationsByParent } = buildStrategyTreeIndex(
      [template],
      [numericParent, stringParent],
    );

    expect(nodeMap.get("tpl-undefined")).toBe(template);
    expect(variationsByParent.get("7")).toEqual([numericParent, stringParent]);
  });

  it("renders a large tree without rescanning strategies for every template", () => {
    const templateCount = 20;
    const strategyCount = 100;
    const templates = Array.from({ length: templateCount }, (_, i) => makeTemplate(i + 1));
    let parentIdReads = 0;
    const variations = Array.from({ length: strategyCount }, (_, i) => {
      const parentId = (i % templateCount) + 1;
      const variation = makeVariation(templateCount + i + 1, parentId);
      Object.defineProperty(variation, "parent_id", {
        configurable: true,
        get() {
          parentIdReads++;
          return parentId;
        },
      });
      return variation;
    });

    render(() => (
      <UIProvider>
        <TemplateTreeView
          templates={templates}
          strategies={variations}
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

    expect(screen.getByTestId("template-tree-panel")).toBeInTheDocument();
    // The index is memoised once; renderNode must not re-filter strategies.
    // Old code: 2 passes x 20 templates x 100 strategies = 4000 reads.
    expect(parentIdReads).toBe(strategyCount);
  });

  it("sync confirmation still reports the exact variation count", () => {
    const templates = [makeTemplate(1, { name: "ORB" })];
    const variations = [makeVariation(2, 1), makeVariation(3, 1)];
    const onSyncVariations = vi.fn();
    const confirmMock = vi.fn().mockReturnValue(false);
    window.confirm = confirmMock as unknown as typeof window.confirm;

    render(() => (
      <UIProvider>
        <TemplateTreeView
          templates={templates}
          strategies={variations}
          onEditTemplate={vi.fn()}
          onSyncVariations={onSyncVariations}
          onCreateFromTemplate={vi.fn()}
          onEditStrategy={vi.fn()}
          onDeleteStrategy={vi.fn()}
          onUpdate={vi.fn().mockResolvedValue(undefined)}
          isLoading={false}
        />
      </UIProvider>
    ));
    fireEvent.click(screen.getByTestId("sync-variations-btn-1"));

    expect(confirmMock).toHaveBeenCalledWith('Push "ORB" params to 2 variation(s)?');
    expect(onSyncVariations).not.toHaveBeenCalled();
  });
});
