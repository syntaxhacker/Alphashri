// @vitest-environment happy-dom
/**
 * Design-system accessibility smoke gate.
 *
 * axe-core is already installed transitively via `@storybook/addon-a11y`
 * (axe-core 4.14.1 in node_modules) — no new dependency is added here. It runs
 * in happy-dom: the DOM is real enough for axe's ARIA/name/role rules, and this
 * file asserts that the rules actually executed rather than silently skipped.
 *
 * What this gate cannot cover: happy-dom has no layout or rendering pipeline,
 * so real colour contrast, visible focus, keyboard focus order/trap and screen
 * reader output still need a browser/manual pass (Storybook a11y addon,
 * Playwright + axe, keyboard walkthrough).
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import axe from "axe-core";
import { afterEach, describe, expect, test } from "vitest";
import { Tab, Tabs, TabsList, TabsPanel } from "@/ui/data-display/Tabs";
import { Alert } from "@/ui/feedback/Alert";
import { Button } from "@/ui/inputs/Button";
import { Select } from "@/ui/inputs/Select";
import { TextInput } from "@/ui/inputs/TextInput";
import { Modal } from "@/ui/overlay/Modal";

// The global setup already cleans up, but keep this file self-contained so it
// is hermetic even if run with a different setup config.
afterEach(cleanup);

/** Modal is rendered separately: its open state intentionally makes background inert. */
function renderModal() {
  return render(() => (
    <Modal opened onClose={() => undefined} title="Order details" data-testid="smoke-modal">
      <Button data-testid="smoke-confirm">Confirm</Button>
    </Modal>
  ));
}

/** One composite render exercises the background contract states. */
function renderSmoke() {
  return render(() => (
    <div>
      <Button data-testid="smoke-button">Save changes</Button>
      <TextInput
        data-testid="smoke-ticker"
        id="smoke-ticker-input"
        label="Ticker symbol"
        error="Ticker is required"
      />
      <Select
        label="Exchange"
        data={[
          { value: "nse", label: "NSE" },
          { value: "bse", label: "BSE" },
        ]}
      />
      <Tabs defaultValue="overview">
        <TabsList {...({ "aria-label": "Market sections" } as Record<string, unknown>)}>
          <Tab value="overview">Overview</Tab>
          <Tab value="flow">Flow</Tab>
        </TabsList>
        <TabsPanel value="overview">Regime: trend</TabsPanel>
      </Tabs>
      <Alert title="Heads up">Prices are delayed</Alert>
    </div>
  ));
}

/**
 * Known baseline exceptions: axe rule id -> reason it is tolerated.
 * Empty today: the six smoke states produce zero serious/critical violations.
 * A future exception must be named here with a reason and a narrow selector;
 * never disable the whole suite or lower the impact threshold to hide it.
 */
const KNOWN_BASELINE_EXCEPTIONS: Readonly<Record<string, string>> = Object.freeze({});

/** WCAG 2.0/2.1 A+AA — the same bar as the Storybook a11y addon's default. */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

describe("design-system a11y smoke", () => {
  test("semantic contracts hold for Button, TextInput(error), Select, Tabs, Alert and Modal", () => {
    const { container } = renderSmoke();

    // Button: native control with a text name.
    const button = screen.getByTestId("smoke-button");
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    expect(screen.getByRole("button", { name: "Save changes" })).toBe(button);

    // TextInput with error: labelled, aria-invalid, describedby -> the message.
    const ticker = screen.getByRole("textbox", { name: "Ticker symbol" });
    expect(ticker).toHaveAttribute("aria-invalid", "true");
    const describedBy = ticker.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const messages = (describedBy ?? "").split(/\s+/).filter(Boolean).map((id) => container.querySelector(`[id="${id}"]`));
    expect(messages).not.toContain(null);
    expect(messages.map((node) => node?.textContent).join(" ")).toContain("Ticker is required");

    // Select: native combobox named by its <label>, options exposed.
    const exchange = screen.getByRole("combobox", { name: "Exchange" });
    expect(exchange.tagName).toBe("SELECT");
    expect(screen.getByRole("option", { name: "NSE" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "BSE" })).toBeInTheDocument();

    // Tabs: named tablist, labelled tabs, exactly one selected/tabbable tab,
    // and a panel for the selected tab.
    const tablist = screen.getByRole("tablist", { name: "Market sections" });
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tablist.contains(tabs[0])).toBe(true);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveAttribute("tabindex", "0");
    expect(tabs[1]).toHaveAttribute("aria-selected", "false");
    expect(tabs[1]).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Regime: trend");

    // Alert: announced via role=alert with its title and body.
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Heads up");
    expect(alert).toHaveTextContent("Prices are delayed");

    // Modal is rendered alone because its open state intentionally makes the
    // background inert; keeping it in the composite would hide every control.
    cleanup();
    renderModal();
    const dialog = screen.getByRole("dialog", { name: "Order details" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const close = screen.getByRole("button", { name: "close" });
    expect(dialog.contains(close)).toBe(true);
    expect(close).not.toBeDisabled();
    expect(close.tabIndex).toBeGreaterThanOrEqual(0);
    close.focus();
    expect(document.activeElement).toBe(close);
  });

  test("axe: zero serious/critical WCAG A/AA violations across the rendered states", async () => {
    const { container } = renderSmoke();
    const result = await axe.run(container, {
      runOnly: { type: "tag", values: [...WCAG_TAGS] },
    });

    // Modal is a separate axe target because its open state makes the app
    // background inert, which legitimately hides the composite controls.
    cleanup();
    const modal = renderModal();
    const modalResult = await axe.run(modal.container, {
      runOnly: { type: "tag", values: [...WCAG_TAGS] },
    });

    const results = [result, modalResult];
    // Guard against a false green: axe must have actually executed core rules.
    const executedRules = results.flatMap((r) => [
      ...r.passes,
      ...r.violations,
      ...r.incomplete,
    ]).map((check) => check.id);
    expect(executedRules.length).toBeGreaterThan(10);
    expect(executedRules).toContain("button-name");

    const gated = results.flatMap((r) => r.violations).filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    );
    const unexpected = gated
      .filter((violation) => !(violation.id in KNOWN_BASELINE_EXCEPTIONS))
      .map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        targets: violation.nodes.map((node) => node.target.join(" ")),
        help: violation.help,
      }));
    expect(unexpected).toEqual([]);
  });
});
