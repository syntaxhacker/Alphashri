// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { CompactPanel, CompactStat } from "./compact";
import { TanStackTable } from "./TanStackTable";
import { Badge } from "@/ui/feedback/Badge";
import { Tabs, TabsList, TabsPanel, Tab } from "@/ui/data-display/Tabs";
import { IconRefresh } from "./Icons";
import * as palette from "@/ui/palette";

afterEach(cleanup);

const styleOf = (el: HTMLElement | null): string => el?.getAttribute("style") ?? "";
const classOf = (el: HTMLElement | null): string => el?.getAttribute("class") ?? "";

describe("CompactPanel — terminal chrome", () => {
  it("uses the 2px panel radius, hairline border and panel surface", () => {
    render(() => (
      <CompactPanel title="ORDER BOOK" testId="p">
        <span>body</span>
      </CompactPanel>
    ));
    const style = styleOf(screen.getByTestId("p"));
    expect(style).toContain("border-radius: 2px");
    expect(style).toContain(`border: 1px solid ${palette.BORDER_COLOR}`);
    expect(style).toContain(`background-color: ${palette.SURFACE_COLOR}`);
  });

  it("renders its title as amber uppercase mono with tracking", () => {
    render(() => <CompactPanel title="order book" testId="p"><span /></CompactPanel>);
    const title = screen.getByTestId("p").querySelector<HTMLElement>("[data-compact-header] h4");
    expect(title).not.toBeNull();
    expect(title!.textContent).toBe("order book");
    const style = styleOf(title);
    expect(style).toContain("text-transform: uppercase");
    expect(style).toContain(`color: ${palette.PRIMARY}`);
    expect(style).toContain("letter-spacing: 0.08em");
    expect(style).toContain("font-family:");
    expect(style).toContain("monospace");
  });

  it("indents the panel body by the density pad", () => {
    render(() => <CompactPanel title="x" testId="p"><span /></CompactPanel>);
    const body = screen.getByTestId("p").querySelector<HTMLElement>("[data-compact-card-content]");
    expect(body).not.toBeNull();
    expect(styleOf(body)).toContain("padding: 4px");
  });
});

describe("CompactStat — terminal figures", () => {
  it("renders the value in mono tabular figures", () => {
    render(() => <CompactStat label="PCR" value="1.12" />);
    const stat = document.querySelector<HTMLElement>("[data-compact-stat]");
    expect(stat).not.toBeNull();
    const value = Array.from(stat!.querySelectorAll<HTMLElement>("span, p")).find(
      (el) => el.textContent === "1.12",
    );
    expect(value).toBeDefined();
    const style = styleOf(value ?? null);
    expect(style).toContain("font-family:");
    expect(style).toContain("monospace");
    expect(style).toContain("tabular-nums");
  });
});

describe("TanStackTable — terminal header", () => {
  const columns = [
    { id: "symbol", header: "Symbol", accessorKey: "symbol", meta: { align: "left" as const } },
    { id: "oi", header: "OI", accessorKey: "oi", meta: { align: "right" as const } },
  ];
  const rows = [
    { symbol: "NIFTY", oi: 1200 },
    { symbol: "BANKNIFTY", oi: 800 },
  ];

  it("paints the column header amber, uppercase, mono and bold", () => {
    render(() => <TanStackTable data={rows} columns={columns as never} dataTestId="t" />);
    const th = screen.getByTestId("t").querySelector<HTMLElement>("th");
    expect(th).not.toBeNull();
    const style = styleOf(th);
    expect(style).toContain(`color: ${palette.PRIMARY}`);
    expect(style).toContain("text-transform: uppercase");
    expect(style).toContain("font-weight: 700");
    expect(style).toContain("font-family:");
    expect(style).toContain("monospace");
  });

  it("right-aligns numeric columns and keeps cells tabular", () => {
    render(() => <TanStackTable data={rows} columns={columns as never} dataTestId="t" />);
    const cells = screen.getByTestId("t").querySelectorAll<HTMLElement>("tbody td");
    expect(styleOf(cells[1])).toContain("text-align: right");
    expect(styleOf(cells[0])).toContain("tabular-nums");
  });

  it("uses the panel surface and a 2px container radius", () => {
    render(() => <TanStackTable data={rows} columns={columns as never} dataTestId="t" />);
    const container = screen.getByTestId("t").closest<HTMLElement>(".paper-tanstack-container");
    expect(container).not.toBeNull();
    const style = styleOf(container);
    expect(style).toContain("border-radius: 2px");
    expect(style).toContain(`background-color: ${palette.SURFACE_COLOR}`);
  });
});

describe("Badge — terminal tag", () => {
  it("is uppercase mono with tracking and no pill radius", () => {
    render(() => <Badge data-testid="b">live</Badge>);
    const cls = classOf(screen.getByTestId("b"));
    expect(cls).toContain("uppercase");
    expect(cls).toContain("font-mono");
    expect(cls).toContain("tracking-[0.04em]");
  });
});

describe("Tabs — stacked layout", () => {
  it("puts the panel under a horizontal tab list, not beside it", () => {
    render(() => (
      <Tabs value="a" onChange={() => {}} data-testid="tabs">
        <TabsList data-testid="list">
          <Tab value="a">Alpha</Tab>
          <Tab value="b">Beta</Tab>
        </TabsList>
        <TabsPanel value="a" data-testid="panel">content</TabsPanel>
      </Tabs>
    ));
    const wrapper = classOf(screen.getByTestId("tabs"));
    expect(wrapper).toContain("flex-col");
    expect(wrapper).not.toContain("flex-row");
  });

  it("marks the active tab with an accent underline on a flat strip", () => {
    render(() => (
      <Tabs value="a" onChange={() => {}}>
        <TabsList>
          <Tab value="a" data-testid="tab-a">Alpha</Tab>
          <Tab value="b" data-testid="tab-b">Beta</Tab>
        </TabsList>
        <TabsPanel value="a">content</TabsPanel>
      </Tabs>
    ));
    const active = classOf(screen.getByTestId("tab-a"));
    // Navigation, not a bordered pill: the active tab is marked by an accent
    // underline that lands on the strip's own rule, with sentence-case labels.
    expect(active).toContain("border-b-2");
    expect(active).toContain("border-fin-primary");
    expect(active).toContain("font-semibold");
    expect(active).not.toContain("uppercase");
    const inactive = classOf(screen.getByTestId("tab-b"));
    expect(inactive).toContain("border-transparent");
    expect(inactive).not.toContain("border-fin-primary");
  });
});

describe("Icons — single source set", () => {
  it("renders an svg with a glyph and forwards size", () => {
    const { container } = render(() => <IconRefresh size={14} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("width")).toBe("14");
    expect(svg!.querySelectorAll("path").length).toBeGreaterThan(0);
  });
});
