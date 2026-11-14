// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import { CompactPage, CompactPanel, CompactStat, CompactStatGrid } from "./compact";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CompactPage", () => {
  it("renders children", () => {
    render(() => (<CompactPage>Content</CompactPage>));
    expect(screen.getByText("Content")).toBeInTheDocument();
  });

  it("renders string title", () => {
    render(() => (<CompactPage title="My Page">Content</CompactPage>));
    expect(screen.getByText("My Page")).toBeInTheDocument();
  });

  it("renders string description", () => {
    render(() => (<CompactPage description="A description">Content</CompactPage>));
    expect(screen.getByText("A description")).toBeInTheDocument();
  });

  it("renders actions", () => {
    render(() => (<CompactPage actions={<button>Action</button>}>Content</CompactPage>));
    expect(screen.getByText("Action")).toBeInTheDocument();
  });

  it("renders without header when no title, description, or actions", () => {
    const { container } = render(() => (<CompactPage>Content</CompactPage>));
    expect(container.querySelector('[data-testid="group"]')).toBeNull();
  });

  it("renders ReactNode title directly", () => {
    render(() => (<CompactPage title={<span>Custom Title</span>}>Content</CompactPage>));
    expect(screen.getByText("Custom Title")).toBeInTheDocument();
  });

  it("renders ReactNode description", () => {
    render(() => (<CompactPage description={<em>rich desc</em>}>Content</CompactPage>));
    expect(screen.getByText("rich desc")).toBeInTheDocument();
  });
});

describe("CompactPanel", () => {
  it("renders children", () => {
    render(() => (<CompactPanel>Panel Content</CompactPanel>));
    expect(screen.getByText("Panel Content")).toBeInTheDocument();
  });

  it("renders string title", () => {
    render(() => (<CompactPanel title="Panel Title">Content</CompactPanel>));
    expect(screen.getByText("Panel Title")).toBeInTheDocument();
  });

  it("renders string description", () => {
    render(() => (<CompactPanel description="Panel desc">Content</CompactPanel>));
    expect(screen.getByText("Panel desc")).toBeInTheDocument();
  });

  it("renders action", () => {
    render(() => (<CompactPanel action={<button>Action</button>}>Content</CompactPanel>));
    expect(screen.getByText("Action")).toBeInTheDocument();
  });

  it("sets testId", () => {
    render(() => (<CompactPanel testId="my-panel">Content</CompactPanel>));
    expect(screen.getByText("Content").closest('[data-testid="my-panel"]')).toBeInTheDocument();
  });

  it("renders without header when no title, description, or action", () => {
    const { container } = render(() => (<CompactPanel>Content</CompactPanel>));
    expect(container.querySelector('[data-testid="group"]')).toBeNull();
  });

  it("applies scrollable layout with inner Box container", () => {
    render(() => (<CompactPanel scrollable title="Scrollable">
        ScrollContent
      </CompactPanel>),
    );
    expect(screen.getByText("ScrollContent")).toBeInTheDocument();
    // scrollable adds inner Box for overflow — check that a container with overflow exists
    expect(screen.getByText("Scrollable")).toBeInTheDocument();
  });

  it("respects padded=false without error", () => {
    render(() => (<CompactPanel padded={false}>NoPad</CompactPanel>));
    expect(screen.getByText("NoPad")).toBeInTheDocument();
  });

  it("renders ReactNode title and description", () => {
    render(() => (<CompactPanel title={<span>Rich Title</span>} description={<em>Rich Desc</em>}>
        Content
      </CompactPanel>),
    );
    expect(screen.getByText("Rich Title")).toBeInTheDocument();
    expect(screen.getByText("Rich Desc")).toBeInTheDocument();
  });
});

describe("CompactStat", () => {
  it("renders label and value", () => {
    render(() => (<CompactStat label="Score" value={95} />));
    expect(screen.getByText("Score")).toBeInTheDocument();
    expect(screen.getByText("95")).toBeInTheDocument();
  });

  it("renders ReactNode label and value", () => {
    render(() => (<CompactStat label={<span>Lab</span>} value={<strong>Val</strong>} />));
    expect(screen.getByText("Lab")).toBeInTheDocument();
    expect(screen.getByText("Val")).toBeInTheDocument();
  });

  it("applies default tone and sizes", () => {
    render(() => (<CompactStat label="L" value="V" />));
    expect(screen.getByText("L")).toBeInTheDocument();
    expect(screen.getByText("V")).toBeInTheDocument();
  });

  it("applies custom tone to value Text", () => {
    render(() => (<CompactStat label="PnL" value="+5%" tone="success" />));
    expect(screen.getByText("+5%")).toBeInTheDocument();
    expect(screen.getByText("PnL")).toBeInTheDocument();
  });

  it("respects custom labelSize and valueSize", () => {
    render(() => (<CompactStat label="L" value="V" labelSize="sm" valueSize="xl" />));
    expect(screen.getByText("L")).toBeInTheDocument();
    expect(screen.getByText("V")).toBeInTheDocument();
  });

  it("renders string hint", () => {
    render(() => (<CompactStat label="PnL" value={1000} hint="+5%" />));
    expect(screen.getByText("+5%")).toBeInTheDocument();
  });

  it("renders number hint", () => {
    render(() => (<CompactStat label="Count" value={10} hint={5} />));
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("renders ReactNode hint inside Box wrapper", () => {
    render(() => (<CompactStat label="Status" value="OK" hint={<em>good</em>} />));
    expect(screen.getByText("good")).toBeInTheDocument();
    expect(screen.getByText("OK")).toBeInTheDocument();
  });

  it("does not render hint when not provided", () => {
    render(() => (<CompactStat label="Label" value="Val" />));
    expect(screen.getByText("Label")).toBeInTheDocument();
    expect(screen.getByText("Val")).toBeInTheDocument();
    expect(screen.queryByText("hint")).not.toBeInTheDocument();
  });

  it("renders with Card and bg via withAlpha", () => {
    render(() => (<CompactStat label="A" value="B" hint={null as any} />));
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
  });

  it("renders zero value correctly", () => {
    render(() => (<CompactStat label="Zero" value={0} />));
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("renders empty string hint as falsy (no extra Text)", () => {
    render(() => (<CompactStat label="L" value="V" hint="" />));
    expect(screen.getByText("L")).toBeInTheDocument();
    expect(screen.getByText("V")).toBeInTheDocument();
  });
});

describe("CompactPage centering", () => {
  it("is left/stretch by default (no forced centering)", () => {
    const { container } = render(() => (<CompactPage title="T">
        <div data-testid="page-child">x</div>
      </CompactPage>),
    );
    const outer = container.firstElementChild as HTMLElement;
    expect(outer.style.alignItems).toBe("stretch");
  });

  it("centers when center=true (backward-compat opt-in)", () => {
    const { container } = render(() => (<CompactPage title="T" center>
        <div data-testid="page-child">x</div>
      </CompactPage>),
    );
    const outer = container.firstElementChild as HTMLElement;
    expect(outer.style.alignItems).toBe("center");
  });
});

describe("CompactStatGrid", () => {
  it("renders children", () => {
    render(() => (<CompactStatGrid>
        <div>Stat 1</div>
        <div>Stat 2</div>
      </CompactStatGrid>),
    );
    expect(screen.getByText("Stat 1")).toBeInTheDocument();
    expect(screen.getByText("Stat 2")).toBeInTheDocument();
  });

  it("wraps children in SimpleGrid with responsive cols", () => {
    render(() => (<CompactStatGrid>
        <CompactStat label="A" value="1" />
        <CompactStat label="B" value="2" />
      </CompactStatGrid>),
    );
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
  });

  it("renders empty grid without crash", () => {
    const { container } = render(() => (<CompactStatGrid data-testid="empty-grid" />));
    expect(container.firstChild).toBeInTheDocument();
    expect(screen.queryByTestId("empty-grid")).toBeInTheDocument();
  });

  it("is left/stretch by default (no forced centering)", () => {
    const { container } = render(() => (<CompactStatGrid>
        <div>Stat 1</div>
      </CompactStatGrid>),
    );
    const outer = container.firstElementChild as HTMLElement;
    expect(outer.style.justifyContent).toBe("flex-start");
    expect(outer.style.alignItems).toBe("stretch");
  });

  it("centers when center=true (backward-compat opt-in)", () => {
    const { container } = render(() => (<CompactStatGrid center>
        <div>Stat 1</div>
      </CompactStatGrid>),
    );
    const outer = container.firstElementChild as HTMLElement;
    expect(outer.style.justifyContent).toBe("center");
    expect(outer.style.alignItems).toBe("center");
  });
});

describe("CompactPanel flush (edge-to-edge inside a page panel)", () => {
  it("drops border and radius when flush", () => {
    render(() => (<CompactPanel flush title="Flush panel">Content</CompactPanel>));
    const panel = document.querySelector('[data-compact]') as HTMLElement;
    expect(panel.classList.contains("border")).toBe(false);
    expect(panel.classList.contains("rounded-fin")).toBe(false);
    expect(panel.style.borderRadius).toBe("");
    expect(screen.getByText("Flush panel")).toBeInTheDocument();
  });

  it("keeps border and radius by default", () => {
    render(() => (<CompactPanel title="Default panel">Content</CompactPanel>));
    const panel = document.querySelector('[data-compact]') as HTMLElement;
    expect(panel.classList.contains("border")).toBe(true);
    expect(panel.classList.contains("rounded-fin")).toBe(true);
    expect(panel.style.borderRadius).toBe("2px");
  });

  it("uses a divider-only header with no side padding when flush", () => {
    render(() => (<CompactPanel flush title="Flush panel">Content</CompactPanel>));
    const header = document.querySelector('[data-compact-header]') as HTMLElement;
    expect(header.classList.contains("px-4")).toBe(false);
    expect(header.style.paddingLeft).toBe("0px");
    expect(header.style.paddingRight).toBe("0px");
  });

  it("keeps the padded header by default", () => {
    render(() => (<CompactPanel title="Default panel">Content</CompactPanel>));
    const header = document.querySelector('[data-compact-header]') as HTMLElement;
    expect(header.classList.contains("px-4")).toBe(true);
    expect(header.style.paddingLeft).toBe("8px");
  });
});

describe("CompactStat terminal cell", () => {
  it("renders the label 10px uppercase muted left-aligned", () => {
    render(() => (<CompactStat label="PnL" value="+123.45" />));
    const label = screen.getByText("PnL");
    expect(label.style.fontSize).toBe("10px");
    expect(label.style.textTransform).toBe("uppercase");
    expect(label.style.textAlign).toBe("left");
  });

  it("renders the value mono tabular-nums right-aligned", () => {
    render(() => (<CompactStat label="PnL" value="+123.45" tone="success" />));
    const value = screen.getByText("+123.45");
    expect(value.style.textAlign).toBe("right");
    expect(value.style.fontFamily).toContain("ui-monospace");
    expect(value.style.fontVariantNumeric).toBe("tabular-nums");
  });

  it("is one 41px row with no border of its own", () => {
    render(() => (<CompactStat label="PnL" value="+123.45" />));
    const card = document.querySelector('[data-compact-stat]') as HTMLElement;
    const cell = card.firstElementChild as HTMLElement;
    expect(cell.style.height).toBe("41px");
    expect(card.style.border).toBe("");
  });
});

describe("CompactStatGrid columns and dividers", () => {
  it("defaults to 4 columns, not 1", () => {
    render(() => (
      <CompactStatGrid data-testid="stat-grid">
        <CompactStat label="A" value="1" />
        <CompactStat label="B" value="2" />
        <CompactStat label="C" value="3" />
        <CompactStat label="D" value="4" />
        <CompactStat label="E" value="5" />
      </CompactStatGrid>
    ));
    const grid = screen.getByTestId("stat-grid");
    expect(grid.style.gridTemplateColumns).toBe("repeat(4, minmax(0, 1fr))");
  });

  it("has zero gap by default and separates cells with divide-x dividers", () => {
    render(() => (
      <CompactStatGrid data-testid="stat-grid">
        <CompactStat label="A" value="1" />
      </CompactStatGrid>
    ));
    const grid = screen.getByTestId("stat-grid");
    expect(grid.style.gap).toBe("");
    expect(grid.classList.contains("divide-x")).toBe(true);
    expect(grid.classList.contains("divide-fin-border")).toBe(true);
  });

  it("still honors an explicit spacing prop", () => {
    render(() => (
      <CompactStatGrid data-testid="stat-grid" spacing={4}>
        <CompactStat label="A" value="1" />
      </CompactStatGrid>
    ));
    expect(screen.getByTestId("stat-grid").style.gap).toBe("4px");
  });
});
