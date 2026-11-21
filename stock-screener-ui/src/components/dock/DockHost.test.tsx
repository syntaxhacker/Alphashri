// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { createSignal } from "solid-js";
import type { Accessor } from "solid-js";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DockHost } from "./DockHost";
import { REPORT_PANELS } from "./reportPanels";
import type { DockLayout, DockPanelContext, DockPanelSpec } from "./types";

const FULL_CTX: Accessor<DockPanelContext> = () => ({
  symbol: "NIFTY",
  market: "india",
  timeframe: "1m",
  expiry: "2026-11-26",
});

const THREE: DockLayout = {
  panes: [
    { id: "report.chart", size: 1 },
    { id: "report.walls", size: 0.42 },
    { id: "report.breadth", size: 0.3 },
  ],
  hidden: [],
};

/** Controlled host so keyboard/pointer edits round-trip through the emitted layout. */
function Harness(props: {
  layout: DockLayout;
  stacked?: boolean;
  context?: Accessor<DockPanelContext>;
  onLayout?: (layout: DockLayout) => void;
}) {
  const [layout, setLayout] = createSignal<DockLayout>(props.layout);
  const apply = (next: DockLayout) => {
    setLayout(next);
    props.onLayout?.(next);
  };
  return (
    <DockHost
      specs={REPORT_PANELS}
      layout={layout()}
      context={props.context ?? FULL_CTX}
      onLayoutChange={apply}
      stacked={props.stacked}
    />
  );
}

afterEach(() => cleanup());

describe("DockHost", () => {
  it("renders N panes in order with flex bases matching their size", () => {
    const { container } = render(() => <Harness layout={THREE} stacked={false} />);

    const panes = Array.from(container.querySelectorAll<HTMLElement>("[data-dock-pane]"));
    expect(panes.map((p) => p.getAttribute("data-pane-id"))).toEqual([
      "report.chart",
      "report.walls",
      "report.breadth",
    ]);
    expect(panes.map((p) => p.style.flexGrow)).toEqual(["1", "0.42", "0.3"]);
    expect(panes.every((p) => p.style.flexBasis === "0%" && p.style.minHeight === "0px")).toBe(true);
  });

  it("reproduces the ReportWorkspace 2-column split from panes 1 : 0.42 without fixed heights", () => {
    const twoPanes: DockLayout = {
      panes: [
        { id: "report.chart", size: 1 },
        { id: "report.walls", size: 0.42 },
      ],
      hidden: [],
    };
    const { container } = render(() => <Harness layout={twoPanes} stacked={false} />);

    const panes = Array.from(container.querySelectorAll<HTMLElement>("[data-dock-pane]"));
    expect(panes.map((p) => p.style.flexGrow)).toEqual(["1", "0.42"]);
    expect(panes.every((p) => p.style.flexBasis === "0%" && p.style.height === "")).toBe(true);
  });

  it("below 1200px stacks the panes with no drag handles", () => {
    const { container } = render(() => <Harness layout={THREE} stacked={true} />);

    expect(container.querySelectorAll("[data-resize-handle]")).toHaveLength(0);
    const panes = Array.from(container.querySelectorAll<HTMLElement>("[data-dock-pane]"));
    expect(panes).toHaveLength(3);
    expect(panes.every((p) => p.style.flexBasis === "auto" && p.style.width === "100%")).toBe(true);
  });

  it("Alt+Arrow keyboard resize changes a pane size and emits the new layout", async () => {
    const onLayout = vi.fn();
    const twoPanes: DockLayout = {
      panes: [
        { id: "report.chart", size: 1 },
        { id: "report.walls", size: 0.42 },
      ],
      hidden: [],
    };
    const { container } = render(() => (
      <Harness layout={twoPanes} stacked={false} onLayout={onLayout} />
    ));

    fireEvent.keyDown(screen.getByTestId("dock-handle-0"), { key: "ArrowRight", altKey: true });

    await waitFor(() => expect(onLayout).toHaveBeenCalled());
    const emitted = onLayout.mock.lastCall![0] as DockLayout;
    expect(emitted.panes[0].size).toBeGreaterThan(1);
    expect(emitted.panes[1].size).toBeLessThan(0.42);
    expect(emitted.panes[0].size + emitted.panes[1].size).toBeCloseTo(1.42);

    const chart = container.querySelector<HTMLElement>("[data-pane-id='report.chart']")!;
    await waitFor(() => expect(chart.getAttribute("data-pane-size")).toBe(String(emitted.panes[0].size)));
  });

  it("a panel whose requires are unmet renders a defined empty state instead of crashing", () => {
    render(() => <Harness layout={THREE} stacked={false} context={() => ({})} />);

    const chartEmpty = screen.getByTestId("dock-empty-report.chart");
    expect(chartEmpty).toHaveTextContent("symbol");
    const breadthEmpty = screen.getByTestId("dock-empty-report.breadth");
    expect(breadthEmpty).toHaveTextContent("expiry");
    expect(screen.getByTestId("demo-report-walls")).toBeInTheDocument();
    expect(screen.queryByTestId("demo-report-chart")).not.toBeInTheDocument();
  });

  it("detaching a pane emits it into hidden and restore brings it back", async () => {
    const onLayout = vi.fn();
    render(() => <Harness layout={THREE} stacked={false} onLayout={onLayout} />);

    fireEvent.click(screen.getByTestId("dock-detach-report.walls"));
    await waitFor(() => expect(onLayout).toHaveBeenCalled());
    expect((onLayout.mock.lastCall![0] as DockLayout).hidden).toContain("report.walls");
    expect(screen.queryByTestId("dock-pane-report.walls")).not.toBeInTheDocument();

    const restoreStrip = screen.getByTestId("dock-hidden-panels");
    fireEvent.click(within(restoreStrip).getByTestId("dock-restore-report.walls"));
    await waitFor(() => expect(screen.getByTestId("dock-pane-report.walls")).toBeInTheDocument());
  });
});

/** Minimal specs that exercise the widened data/commands/maxWidth contract. */
function customHost<D extends object = Record<string, unknown>>(
  specs: DockPanelSpec<D>[],
  layout: DockLayout,
  context?: Accessor<DockPanelContext>,
) {
  const [live, setLive] = createSignal<DockLayout>(layout);
  const result = render(() => (
    <DockHost
      specs={specs}
      layout={live()}
      context={context ?? FULL_CTX}
      onLayoutChange={setLive}
      stacked={false}
    />
  ));
  return { ...result, setLive };
}

describe("DockPanelSpec data/commands/maxWidth", () => {
  it("(a) reactive data: mutating the source re-renders the mounted panel", async () => {
    const [label, setLabel] = createSignal("NIFTY");
    const spec: DockPanelSpec<{ label: string }> = {
      id: "probe.reactive",
      page: "report",
      title: "REACTIVE",
      size: 1,
      minWidth: 0,
      singleton: true,
      requires: [],
      data: () => ({ label: label() }),
      mount: (_ctx, api) => <div data-testid="reactive-probe">{api.data()!.label}</div>,
    };
    customHost([spec], { panes: [{ id: "probe.reactive", size: 1 }], hidden: [] });

    expect(screen.getByTestId("reactive-probe")).toHaveTextContent("NIFTY");
    setLabel("SENSEX");
    await waitFor(() => expect(screen.getByTestId("reactive-probe")).toHaveTextContent("SENSEX"));
  });

  it("(b) commands are optional: a panel with no commands still renders", () => {
    const spec: DockPanelSpec<{ label: string }> = {
      id: "probe.nocommands",
      page: "report",
      title: "NO COMMANDS",
      size: 1,
      minWidth: 0,
      singleton: true,
      requires: [],
      data: () => ({ label: "ok" }),
      // Must not throw when the host supplies an empty command set.
      mount: (_ctx, api) => (
        <div data-testid="no-commands-probe">
          {api.data()!.label} · {api.commands.onTimeframeChange ? "armed" : "unarmed"}
        </div>
      ),
    };
    customHost([spec], { panes: [{ id: "probe.nocommands", size: 1 }], hidden: [] });

    expect(screen.getByTestId("no-commands-probe")).toHaveTextContent("ok · unarmed");
  });

  it("(d) maxWidth clamps a pane and reproduces minmax(0, 420px)", () => {
    const specs: DockPanelSpec[] = [
      {
        id: "main",
        page: "report",
        title: "MAIN",
        size: 1,
        minWidth: 0,
        singleton: true,
        requires: [],
        mount: () => <div data-testid="main-probe" />,
      },
      {
        id: "side",
        page: "report",
        title: "SIDE",
        size: 0.42,
        minWidth: 0,
        maxWidth: 420,
        singleton: true,
        requires: [],
        mount: () => <div data-testid="side-probe" />,
      },
    ];
    const { container } = customHost(specs, {
      panes: [
        { id: "main", size: 1 },
        { id: "side", size: 0.42, maxWidth: 420 },
      ],
      hidden: [],
    });

    const side = container.querySelector<HTMLElement>("[data-pane-id='side']")!;
    expect(side.style.maxWidth).toBe("420px");
    expect(side.style.minWidth).toBe("0px");
    expect(side.style.flexGrow).toBe("0.42");
    expect(side.style.flexBasis).toBe("0%");
    // A width ceiling is not a height: no fixed height leaks into the flex pane.
    expect(side.style.height).toBe("");
  });
});
