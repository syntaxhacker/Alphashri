import { describe, it, expect } from "vitest";
import { renderStrategyForm } from "./form";
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

describe("renderStrategyForm", () => {
  it("renders modal overlay and form structure when no arguments provided", () => {
    const html = renderStrategyForm(null, null);
    expect(html).toContain('data-testid="strategy-modal"');
    expect(html).toContain('data-testid="strategy-form"');
    expect(html).toContain('id="strategy-form"');
  });

  it("renders 'New ORB Variation' title by default", () => {
    const html = renderStrategyForm(null, null);
    expect(html).toContain("<h3>New ORB Variation</h3>");
  });

  it("uses parent template strategy_type in title when provided", () => {
    const parent = makeStrategy({ strategy_type: "EMA_CROSS" });
    const html = renderStrategyForm(null, parent);
    expect(html).toContain("<h3>New EMA_CROSS Variation</h3>");
  });

  it("renders 'Edit Strategy' title when editingStrategy is provided", () => {
    const editing = makeStrategy({ name: "My Strategy" });
    const html = renderStrategyForm(editing, null);
    expect(html).toContain("<h3>Edit Strategy</h3>");
  });

  it("renders 'Create Strategy' button for new form", () => {
    const html = renderStrategyForm(null, null);
    expect(html).toContain("Create Strategy");
    expect(html).toContain('data-testid="save-strategy-btn"');
  });

  it("renders 'Save Changes' button for edit form", () => {
    const editing = makeStrategy();
    const html = renderStrategyForm(editing, null);
    expect(html).toContain("Save Changes");
  });

  it("includes cancel button", () => {
    const html = renderStrategyForm(null, null);
    expect(html).toContain('data-testid="cancel-strategy-btn"');
    expect(html).toContain("Cancel");
  });
});

describe("renderStrategyForm default values", () => {
  it("uses built-in defaults when no strategy or template is provided", () => {
    const html = renderStrategyForm(null, null);

    expect(html).toContain('value="45"');
    expect(html).toContain('value="0.4"');
    expect(html).toContain('value="1.2"');
    expect(html).toContain('value="0.5"');
    expect(html).toContain('value="3"');
    expect(html).toContain('value="5"');
    expect(html).toContain('value="5000"');
    expect(html).toContain('value="100000"');
    expect(html).toContain('value="30"');
    expect(html).toContain('value="1.5"');
  });

  it("converts risk percentages from decimal to display values (×100)", () => {
    const html = renderStrategyForm(null, null);
    expect(html).toContain('value="10"'); // max_capital_per_trade_pct: 0.1 * 100
    expect(html).toContain('value="2"'); // max_daily_loss_pct: 0.02 * 100
    expect(html).toContain('value="50"'); // max_total_exposure_pct: 0.5 * 100
    expect(html).toContain('value="1"'); // risk_per_trade_pct: 0.01 * 100
  });

  it("uses editingStrategy values when provided", () => {
    const editing = makeStrategy({
      name: "Custom Name",
      or_minutes: 15,
      sl_pct: 0.8,
      tp_pct: 2.5,
      max_positions: 10,
    });
    const html = renderStrategyForm(editing, null);

    expect(html).toContain('value="Custom Name"');
    expect(html).toContain('value="15"');
    expect(html).toContain('value="0.8"');
    expect(html).toContain('value="2.5"');
    expect(html).toContain('value="10"');
  });

  it("falls back to parent template values when editingStrategy is null", () => {
    const parent = makeStrategy({
      strategy_type: "52W_CHASER",
      or_minutes: 60,
      sl_pct: 0.6,
      tp_pct: 3.0,
    });
    const html = renderStrategyForm(null, parent);

    expect(html).toContain('value="60"');
    expect(html).toContain('value="0.6"');
    expect(html).toContain('value="3"');
    expect(html).toContain('value="52W_CHASER"');
  });

  it("editingStrategy values take precedence over parent template values", () => {
    const editing = makeStrategy({ or_minutes: 10, sl_pct: 0.2 });
    const parent = makeStrategy({ or_minutes: 60, sl_pct: 0.9 });
    const html = renderStrategyForm(editing, parent);

    expect(html).toContain('value="10"');
    expect(html).toContain('value="0.2"');
  });

  it("sets parent_id from editingStrategy when available", () => {
    const editing = makeStrategy({ parent_id: 42 });
    const html = renderStrategyForm(editing, null);
    expect(html).toContain('value="42"');
  });

  it("sets parent_id from parentTemplate when editingStrategy has no parent_id", () => {
    const parent = makeStrategy({ id: "parent-uuid-001", internal_id: 99 });
    const html = renderStrategyForm(null, parent);
    expect(html).toContain('value="parent-uuid-001"');
  });

  it("sets empty parent_id when neither editingStrategy nor parentTemplate provides one", () => {
    const html = renderStrategyForm(null, null);
    expect(html).toContain('value=""');
  });

  it("sets strategy-id hidden field from editingStrategy", () => {
    const editing = makeStrategy({ id: "edit-uuid-123" });
    const html = renderStrategyForm(editing, null);
    expect(html).toContain('value="edit-uuid-123"');
  });

  it("sets empty strategy-id hidden field for new form", () => {
    const html = renderStrategyForm(null, null);
    expect(html).toContain('value=""');
  });
});

describe("renderStrategyForm edit mode", () => {
  it("shows is_default checkbox when editing", () => {
    const editing = makeStrategy({ is_default: true });
    const html = renderStrategyForm(editing, null);
    expect(html).toContain('id="strategy-is-default"');
    expect(html).toContain("checked");
  });

  it("renders is_default checkbox unchecked when is_default is false", () => {
    const editing = makeStrategy({ is_default: false });
    const html = renderStrategyForm(editing, null);
    expect(html).toContain('id="strategy-is-default"');
    expect(html).not.toContain("checked");
  });

  it("hides is_default checkbox for new form", () => {
    const html = renderStrategyForm(null, null);
    expect(html).not.toContain('id="strategy-is-default"');
  });

  it("prefills description textarea", () => {
    const editing = makeStrategy({ description: "A test description" });
    const html = renderStrategyForm(editing, null);
    expect(html).toContain("A test description");
  });

  it("renders empty description by default", () => {
    const html = renderStrategyForm(null, null);
    expect(html).toMatch(/<textarea[^>]*><\/textarea>/);
  });
});
