// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { createSignal } from "solid-js";
import { TYPE_CLASS, TYPE_SCALE } from "@/ui";
import {
  LiveTapeDisclosure,
  LocalCompactPanel,
  LocalCompactStat,
  LocalEmptyState,
} from "./reportBits";

const headerOf = (root: HTMLElement) =>
  root.querySelector<HTMLElement>("[data-compact-card-header]");
const bodyOf = (root: HTMLElement) =>
  root.querySelector<HTMLElement>("[data-compact-card-content]");

const tokens = (cls: string) => cls.split(/\s+/);
const stepOf = (cls: string) => {
  const role = (Object.keys(TYPE_CLASS) as Array<keyof typeof TYPE_CLASS>).find((key) =>
    tokens(cls).includes(TYPE_CLASS[key]),
  );
  return role ? TYPE_SCALE[role].size : NaN;
};

afterEach(cleanup);

describe("LocalCompactPanel", () => {
  it("emits the body attribute that fill-height callers target", () => {
    // NiftyChartPanel styles its content via
    // `[&_[data-compact-card-content]]:flex-1`, so the attribute must exist or
    // the selector silently matches nothing.
    const { container } = render(() => (
      <LocalCompactPanel title="chart" testId="panel">
        <div />
      </LocalCompactPanel>
    ));

    expect(bodyOf(container)).not.toBeNull();
  });

  it("lets the body own the leftover height so a fill child is not clipped", () => {
    const { container } = render(() => (
      <LocalCompactPanel title="chart" testId="panel">
        <div data-testid="filler" />
      </LocalCompactPanel>
    ));

    const body = bodyOf(container)!;
    // Without flex-1 the body shrinks to its content, which collapsed the
    // NIFTY chart to 30px inside a 300px panel.
    expect(body.className).toContain("flex-1");
    expect(body.className).toContain("min-h-0");
  });

  it("keeps the body scrollable and padded on the 8px scale unless flush", () => {
    const { container: padded } = render(() => (
      <LocalCompactPanel title="a" testId="padded">
        <div />
      </LocalCompactPanel>
    ));
    const { container: flush } = render(() => (
      <LocalCompactPanel title="b" testId="flush" flush>
        <div />
      </LocalCompactPanel>
    ));

    expect(bodyOf(padded)!.className).toContain("overflow-auto");
    expect(bodyOf(padded)!.className).toContain("p-2");
    expect(bodyOf(padded)!.className).toContain("gap-2");
    expect(bodyOf(padded)!.className).not.toContain("p-[6px]");
    expect(bodyOf(flush)!.className).not.toContain("p-2");
  });

  it("puts a 14px panel title above 13px values and 12px labels", () => {
    const { container } = render(() => (
      <LocalCompactPanel title="WALLS" testId="panel" action={<span>detail</span>}>
        <LocalCompactStat testId="stat" label="ATM IV" value="18.42%" hint="fixed strike" />
      </LocalCompactPanel>
    ));

    const title = headerOf(container)!.querySelector("span")!;
    const label = screen.getByTestId("stat").querySelector("span")!;
    const value = screen.getByTestId("stat").querySelectorAll("span")[1];

    expect(stepOf(title.className)).toBe(TYPE_SCALE.label.size);
    expect(stepOf(value.className)).toBe(TYPE_SCALE.body.size);
    expect(stepOf(label.className)).toBe(TYPE_SCALE.micro.size);
    // Monotone hierarchy: the title reads first, the value second, the label
    // is supporting text — not three equal-weight 12px strings.
    expect(stepOf(title.className)).toBeGreaterThan(stepOf(value.className));
    expect(stepOf(value.className)).toBeGreaterThan(stepOf(label.className));
    expect(tokens(title.className)).toContain("font-bold");
    expect(tokens(label.className)).toContain("text-fin-text-muted");
  });

  it("spends space deliberately: 12/8 header and 8px body rhythm", () => {
    const { container } = render(() => (
      <LocalCompactPanel title="WALLS" testId="panel">
        <LocalEmptyState testId="empty" title="No tape" description="Waiting for rows." />
      </LocalCompactPanel>
    ));

    const headerClass = headerOf(container)!.className;
    for (const cls of ["px-3", "py-2", "gap-x-3", "gap-y-2", "border-b"]) {
      expect(tokens(headerClass), cls).toContain(cls);
    }
    expect(headerClass).not.toContain("py-1");
    expect(headerClass).not.toContain("p-[6px]");

    const empty = screen.getByTestId("empty");
    for (const cls of ["px-3", "py-4", "gap-2"]) {
      expect(tokens(empty.className), cls).toContain(cls);
    }
    expect(stepOf(empty.querySelector("span")!.className)).toBe(TYPE_SCALE.label.size);
    expect(stepOf(empty.querySelectorAll("span")[1].className)).toBe(TYPE_SCALE.body.size);
  });

  it("stacks header title and action at 390 but stays one compact row at 1600", () => {
    const { container } = render(() => (
      <LocalCompactPanel title="NIFTY chart" testId="panel" action={<span>controls</span>}>
        <div />
      </LocalCompactPanel>
    ));

    const headerClass = headerOf(container)!.className;
    expect(tokens(headerClass)).toContain("flex-wrap");
    const breakpoint = Number(headerClass.match(/max-\[(\d+)px\]:flex-col/)?.[1]);
    // The phone rule must cover a 390px viewport; unprefixed flex-col would
    // also break the compact 1600 layout, so it has to be max-* only.
    expect(breakpoint).toBeGreaterThanOrEqual(390);
    expect(tokens(headerClass)).toContain("max-[640px]:items-stretch");
    expect(tokens(headerClass)).not.toContain("flex-col");

    // Wrapping grows the header; a fixed height/min-height would leave a dead
    // vertical gap or clip the action on the stacked row.
    expect(headerClass).not.toMatch(/(?:^|\s)(?:min-)?h-\d/);

    // The title is the element allowed to give way; the action renders as a
    // direct child (no wrapper) so existing header-child selectors still hold.
    const title = headerOf(container)!.querySelector("span")!;
    expect(tokens(title.className)).toContain("min-w-0");
    expect(tokens(title.className)).toContain("break-words");
  });
});

describe("LocalCompactStat", () => {
  it("uses 8px cell padding and keeps the testid", () => {
    render(() => <LocalCompactStat testId="stat" label="Straddle" value="112.4" />);
    const cell = screen.getByTestId("stat");
    for (const cls of ["px-2", "py-2", "gap-1"]) {
      expect(tokens(cell.className), cls).toContain(cls);
    }
  });
});

describe("LiveTapeDisclosure", () => {
  it("preserves testids, ARIA and collapse behaviour with a 14px section label", () => {
    render(() => (
      <LiveTapeDisclosure open={false} onToggle={() => {}} testId="disc" label="FLOW WINDOWS">
        <div data-testid="band" />
      </LiveTapeDisclosure>
    ));

    const toggle = screen.getByTestId("nifty-live-tape-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", "nifty-live-tape-content");
    expect(toggle).toHaveTextContent("FLOW WINDOWS");
    expect(screen.getByTestId("nifty-live-tape-chevron")).toHaveAttribute("aria-hidden", "true");

    const content = screen.getByTestId("nifty-live-tape-content");
    expect(content.id).toBe("nifty-live-tape-content");
    expect(content.style.display).toBe("none");
    expect(screen.getByTestId("band")).toBeInTheDocument();

    // The control carries the 14px section size; the hint opts back down to
    // 12px so it reads as supporting text rather than a second title.
    const labelText = toggle.querySelectorAll("span")[1];
    const hint = toggle.querySelectorAll("span")[2];
    expect(stepOf(toggle.className)).toBe(TYPE_SCALE.label.size);
    expect(stepOf(hint.className)).toBe(TYPE_SCALE.micro.size);
    expect(stepOf(toggle.className)).toBeGreaterThan(stepOf(hint.className));
    expect(tokens(labelText.className)).toContain("whitespace-normal");

    // 28px control on desktop, free to grow if the hint wraps at 390.
    expect(tokens(toggle.className)).toContain("h-7");
    expect(tokens(toggle.className)).toContain("min-h-7");
    expect(tokens(toggle.className)).toContain("flex-wrap");
    expect(tokens(toggle.className)).toContain("max-[480px]:h-auto");
  });

  it("toggles the same content without unmounting it", () => {
    const [open, setOpen] = createSignal(false);
    render(() => (
      <LiveTapeDisclosure open={open()} onToggle={() => setOpen((v) => !v)} label="LIVE TAPE">
        <div data-testid="band" />
      </LiveTapeDisclosure>
    ));

    fireEvent.click(screen.getByTestId("nifty-live-tape-toggle"));
    expect(screen.getByTestId("nifty-live-tape-toggle")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("nifty-live-tape-content").style.display).toBe("flex");
    expect(screen.getByTestId("band")).toBeInTheDocument();
  });
});

describe("reportBits type contract", () => {
  it("uses only shared scale tokens and never crosses below the 12px floor", () => {
    const source = readFileSync(resolve(process.cwd(), "src/pages/report/reportBits.tsx"), "utf8");
    const scale = Object.values(TYPE_CLASS);
    const used = [...source.matchAll(/\btext-ui-[a-z]+/g)].map((m) => m[0]);
    expect(used.length).toBeGreaterThan(0);
    for (const cls of new Set(used)) {
      expect(scale, cls).toContain(cls);
    }
    const literals = [...source.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].map((m) => Number(m[1]));
    expect(literals.filter((px) => px < TYPE_SCALE.micro.size)).toEqual([]);
  });
});
