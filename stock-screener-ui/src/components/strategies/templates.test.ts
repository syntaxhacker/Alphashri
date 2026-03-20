import { describe, it, expect } from "vitest";
import { renderTemplateCard, renderVariationCard } from "./templates";
import type { StrategyConfig } from "../../types/strategies";

function makeStrategy(overrides: Partial<StrategyConfig> = {}): StrategyConfig {
  return {
    id: "test-uuid-001",
    name: "Test Strategy",
    strategy_type: "ORB",
    parent_id: null,
    is_template: true,
    is_active: true,
    is_default: false,
    description: null,
    or_minutes: 45,
    sl_pct: 0.4,
    tp_pct: 1.2,
    min_or_range_pct: 0.5,
    max_or_range_pct: 3.0,
    max_positions: 5,
    max_capital_per_trade_pct: 0.1,
    max_daily_loss_pct: 0.02,
    max_total_exposure_pct: 0.5,
    risk_per_trade_pct: 0.01,
    min_trade_value: 5000,
    max_trade_value: 100000,
    cooldown_minutes: 30,
    max_distance_from_or_pct: 1.5,
    brokerage_pct: 0.0003,
    min_brokerage: 20,
    stt_pct: 0.001,
    exchange_pct: 0.0000345,
    sebi_pct: 0.000001,
    stamp_pct: 0.00003,
    gst_pct: 0.18,
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

describe("renderTemplateCard", () => {
  it("renders template card with strategy name and type", () => {
    const template = makeStrategy({ name: "ORB Template", strategy_type: "ORB" });
    const html = renderTemplateCard(template, []);

    expect(html).toContain('data-testid="strategy-card"');
    expect(html).toContain("ORB Template");
    expect(html).toContain("ORB");
    expect(html).toContain(`data-template-id="${template.id}"`);
  });

  it("shows '0 variations' when no variations exist", () => {
    const template = makeStrategy();
    const html = renderTemplateCard(template, []);

    expect(html).toContain("0 variations");
    expect(html).toContain("No variations created yet.");
  });

  it("shows '0 variations' and no-variations message when filter yields no matches (type mismatch: number parent_id vs string id)", () => {
    const template = makeStrategy({ id: "parent-001" });
    const variation = makeStrategy({ id: "var-001", parent_id: 1 });
    const html = renderTemplateCard(template, [variation]);

    expect(html).toContain("0 variations");
    expect(html).toContain("No variations created yet.");
  });

  it("shows '0 variations' for empty allStrategies array", () => {
    const template = makeStrategy();
    const html = renderTemplateCard(template, []);

    expect(html).toContain("0 variations");
    expect(html).toContain("No variations created yet.");
    expect(html).not.toContain('data-testid="variation-card"');
  });

  it("includes 'Add Variation' button", () => {
    const template = makeStrategy();
    const html = renderTemplateCard(template, []);

    expect(html).toContain('data-testid="add-variation-btn"');
    expect(html).toContain("+ Add Variation");
  });

  it("passes template id, name, and strategy_type to add variation button", () => {
    const template = makeStrategy({
      id: "tpl-42",
      name: "My Template",
      strategy_type: "EMA_CROSS",
    });
    const html = renderTemplateCard(template, []);

    expect(html).toContain("window.createVariation(tpl-42, 'My Template', 'EMA_CROSS')");
  });

  it("hides variations section by default", () => {
    const template = makeStrategy();
    const html = renderTemplateCard(template, []);

    expect(html).toContain('style="display: none;"');
  });

  it("renders expand icon", () => {
    const template = makeStrategy({ id: "expand-001" });
    const html = renderTemplateCard(template, []);

    expect(html).toContain('id="expand-icon-expand-001"');
    expect(html).toContain("▶");
  });
});

describe("renderTemplateCard strategy type icons", () => {
  it("shows chart icon for ORB type", () => {
    const template = makeStrategy({ strategy_type: "ORB" });
    const html = renderTemplateCard(template, []);
    expect(html).toContain("📊");
  });

  it("shows trending icon for EMA_CROSS type", () => {
    const template = makeStrategy({ strategy_type: "EMA_CROSS" });
    const html = renderTemplateCard(template, []);
    expect(html).toContain("📈");
  });

  it("shows target icon for 52W_CHASER type", () => {
    const template = makeStrategy({ strategy_type: "52W_CHASER" });
    const html = renderTemplateCard(template, []);
    expect(html).toContain("🎯");
  });

  it("shows default clipboard icon for unknown type", () => {
    const template = makeStrategy({ strategy_type: "UNKNOWN_TYPE" });
    const html = renderTemplateCard(template, []);
    expect(html).toContain("📋");
  });
});

describe("renderVariationCard", () => {
  it("renders variation name", () => {
    const variation = makeStrategy({ name: "Conservative ORB" });
    const html = renderVariationCard(variation);

    expect(html).toContain('data-testid="variation-card"');
    expect(html).toContain("Conservative ORB");
  });

  it("renders SL, TP, Risk, and Positions params", () => {
    const variation = makeStrategy({
      sl_pct: 0.5,
      tp_pct: 2.0,
      risk_per_trade_pct: 0.02,
      max_positions: 8,
    });
    const html = renderVariationCard(variation);

    expect(html).toContain("0.5%");
    expect(html).toContain("2%");
    expect(html).toContain("0.02%");
    expect(html).toContain("8");
    expect(html).toContain("SL:");
    expect(html).toContain("TP:");
    expect(html).toContain("Risk:");
    expect(html).toContain("Positions:");
  });

  it("shows default badge when is_default is true", () => {
    const variation = makeStrategy({ is_default: true });
    const html = renderVariationCard(variation);

    expect(html).toContain("default");
    expect(html).toContain("⭐");
  });

  it("does not show default badge when is_default is false", () => {
    const variation = makeStrategy({ is_default: false });
    const html = renderVariationCard(variation);

    expect(html).not.toContain("default");
    expect(html).not.toContain("⭐");
  });

  it("renders description when provided", () => {
    const variation = makeStrategy({ description: "A safe variation" });
    const html = renderVariationCard(variation);

    expect(html).toContain("variation-description");
    expect(html).toContain("A safe variation");
  });

  it("omits description element when description is null", () => {
    const variation = makeStrategy({ description: null });
    const html = renderVariationCard(variation);

    expect(html).not.toContain("variation-description");
  });

  it("omits description element when description is empty string", () => {
    const variation = makeStrategy({ description: "" });
    const html = renderVariationCard(variation);

    expect(html).not.toContain("variation-description");
  });

  it("disables delete button for default variation", () => {
    const variation = makeStrategy({ is_default: true });
    const html = renderVariationCard(variation);

    expect(html).toContain('data-testid="delete-strategy-btn"');
    expect(html).toContain("disabled");
  });

  it("enables delete button for non-default variation", () => {
    const variation = makeStrategy({ is_default: false });
    const html = renderVariationCard(variation);

    expect(html).toContain('data-testid="delete-strategy-btn"');
    expect(html).not.toContain("disabled");
  });

  it("renders edit button", () => {
    const variation = makeStrategy();
    const html = renderVariationCard(variation);

    expect(html).toContain('data-testid="edit-strategy-btn"');
  });

  it("includes variation-id data attribute", () => {
    const variation = makeStrategy({ id: "var-123" });
    const html = renderVariationCard(variation);

    expect(html).toContain('data-variation-id="var-123"');
  });
});
