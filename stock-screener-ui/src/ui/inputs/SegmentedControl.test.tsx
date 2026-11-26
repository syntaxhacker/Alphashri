// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { typeSize } from "../typography";
import { SegmentedControl } from "./SegmentedControl";

describe("SegmentedControl — view switch", () => {
  test("renders every item and one shared track", () => {
    render(() => <SegmentedControl data={["a", "b"]} defaultValue="a" data-testid="seg" />);
    const track = screen.getByTestId("seg");
    expect(track).toHaveAttribute("role", "group");
    expect(track.querySelectorAll("button")).toHaveLength(2);
  });

  test("the track is a 6px bordered rail and items are 4px", () => {
    render(() => <SegmentedControl data={["a", "b"]} data-testid="seg2" />);
    const track = screen.getByTestId("seg2");
    const item = track.querySelector("button") as HTMLButtonElement;
    expect(track.style.borderRadius).toBe("6px");
    expect(track.style.borderWidth).toBe("1px");
    expect(track.style.borderStyle).toBe("solid");
    expect(track.style.borderColor).toBe("var(--color-fin-border)");
    expect(item.style.borderRadius).toBe("4px");
    expect(item.style.height).toBe("24px");
  });

  test("the active item is a filled inset block, the others are not", () => {
    render(() => <SegmentedControl value="b" data={["a", "b"]} data-testid="seg3" />);
    const [a, b] = [...screen.getByTestId("seg3").querySelectorAll("button")] as HTMLButtonElement[];
    expect(a).toHaveAttribute("aria-pressed", "false");
    expect(a.className).not.toContain("bg-fin-surface-alt");
    expect(b).toHaveAttribute("aria-pressed", "true");
    expect(b.className).toContain("bg-fin-surface-alt");
  });

  test("an uncontrolled selection moves aria-pressed after a click", () => {
    render(() => <SegmentedControl data={["a", "b"]} defaultValue="a" data-testid="seg4" />);
    const b = screen.getByRole("button", { name: "b" });
    expect(b).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(b);
    expect(b).toHaveAttribute("aria-pressed", "true");
  });

  test("reports the clicked value through onChange", () => {
    const onChange = vi.fn();
    render(() => <SegmentedControl data={["a", "b"]} onChange={onChange} data-testid="seg5" />);
    fireEvent.click(screen.getByRole("button", { name: "b" }));
    expect(onChange).toHaveBeenCalledWith("b");
  });

  test("a disabled item does not switch the view", () => {
    const onChange = vi.fn();
    render(() => (
      <SegmentedControl data={[{ value: "a", label: "Alpha" }, { value: "b", label: "Beta", disabled: true }]} onChange={onChange} data-testid="seg6" />
    ));
    fireEvent.click(screen.getByRole("button", { name: "Beta" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  test("re-reads data after mount", () => {
    const [data, setData] = createSignal<string[]>(["a", "b"]);
    render(() => <SegmentedControl data={data()} data-testid="seg7" />);
    expect(screen.getAllByRole("button")).toHaveLength(2);
    setData(["a", "b", "c"]);
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  test("labels stay at or above the 11px legibility floor in every size", () => {
    const sizes = ["xs", "sm", "md", "lg", "xl"] as const;
    for (const size of sizes) {
      render(() => <SegmentedControl data={["alpha", "beta"]} size={size} data-testid={`floor-${size}`} />);
    }
    for (const size of sizes) {
      const buttons = screen.getByTestId(`floor-${size}`).querySelectorAll("button");
      expect(buttons).toHaveLength(2);
      for (const button of buttons) {
        const px = parseFloat((button as HTMLButtonElement).style.fontSize);
        expect(px, `${size} label font size`).toBeGreaterThanOrEqual(typeSize("micro"));
      }
    }
  });

  test("renders every option of a four-item view toggle", () => {
    render(() => <SegmentedControl data={["NIFTY", "SENSEX", "Chart", "Depth"]} data-testid="seg-four" />);
    const track = screen.getByTestId("seg-four");
    expect([...track.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      "NIFTY",
      "SENSEX",
      "Chart",
      "Depth",
    ]);
  });
});

/** happy-dom has no layout engine; feed the overflow read explicit metrics. */
function setScrollMetrics(
  el: HTMLElement,
  scrollWidth: number,
  clientWidth: number,
  scrollLeft = 0,
) {
  Object.defineProperty(el, "scrollWidth", { configurable: true, value: scrollWidth });
  Object.defineProperty(el, "clientWidth", { configurable: true, value: clientWidth });
  Object.defineProperty(el, "scrollLeft", {
    configurable: true,
    writable: true,
    value: scrollLeft,
  });
  window.dispatchEvent(new Event("resize"));
}

const FIVE_TABS = ["Table", "Vis", "Movers", "Deep Value", "Sections"];
const SCROLL_OWNER = /(?:^|\s)overflow-x-(?:auto|scroll)(?:\s|$)/;

describe("SegmentedControl — opt-in horizontal scroll", () => {
  test("a default caller keeps the clipping rail and equal flex items", () => {
    render(() => <SegmentedControl data={FIVE_TABS} data-testid="seg-default" />);
    const track = screen.getByTestId("seg-default");
    expect(track.className).toContain("overflow-hidden");
    expect(track.className).not.toMatch(SCROLL_OWNER);
    expect((track.querySelector("button") as HTMLElement).className).toContain("flex-1");
    expect(screen.queryByRole("button", { name: "Scroll tabs" })).not.toBeInTheDocument();
  });

  test("scrollable makes the rail the single scroll owner and stops label shrink", () => {
    render(() => <SegmentedControl data={FIVE_TABS} scrollable data-testid="seg-scroll" />);
    const track = screen.getByTestId("seg-scroll");
    expect(track.className).toMatch(SCROLL_OWNER);
    expect(track.className).not.toContain("overflow-hidden");
    expect([...track.querySelectorAll("button")].map((b) => b.textContent)).toEqual(FIVE_TABS);
    for (const button of track.querySelectorAll("button")) {
      expect(button.className, button.textContent ?? "").toContain("min-w-max");
    }
    const wrapper = track.parentElement!;
    expect(wrapper.className).not.toMatch(SCROLL_OWNER);
    const owners = [...wrapper.querySelectorAll<HTMLElement>("*")].filter((el) =>
      SCROLL_OWNER.test(el.className),
    );
    expect(owners).toEqual([track]);
  });

  test("one cue appears only while a clipped label still has unseen content", () => {
    render(() => (
      <SegmentedControl
        data={FIVE_TABS}
        scrollable
        scrollLabel="Scroll tabs"
        data-testid="seg-cue"
      />
    ));
    const track = screen.getByTestId("seg-cue");
    setScrollMetrics(track, 329, 329);
    expect(screen.queryByRole("button", { name: "Scroll tabs" })).not.toBeInTheDocument();

    setScrollMetrics(track, 329, 120);
    expect(screen.getAllByRole("button", { name: "Scroll tabs" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Scroll tabs" })).toBeVisible();
  });

  test("the cue advances the scroll owner and retires at the end", () => {
    render(() => (
      <SegmentedControl
        data={FIVE_TABS}
        scrollable
        scrollLabel="Scroll tabs"
        data-testid="seg-advance"
      />
    ));
    const track = screen.getByTestId("seg-advance");
    setScrollMetrics(track, 400, 120);
    const cue = screen.getByRole("button", { name: "Scroll tabs" });
    expect(cue).toHaveAttribute("tabindex", "-1");
    fireEvent.click(cue);
    expect(track.scrollLeft).toBe(120);

    setScrollMetrics(track, 400, 120, 280);
    expect(screen.queryByRole("button", { name: "Scroll tabs" })).not.toBeInTheDocument();
  });

  test("keeps group semantics and aria-pressed while scrollable", () => {
    render(() => (
      <SegmentedControl
        value="Movers"
        data={FIVE_TABS}
        scrollable
        scrollLabel="Scroll tabs"
        data-testid="seg-aria"
      />
    ));
    const track = screen.getByTestId("seg-aria");
    expect(track).toHaveAttribute("role", "group");
    const movers = within(track).getByRole("button", { name: "Movers" });
    expect(movers).toHaveAttribute("aria-pressed", "true");
    const sections = within(track).getByRole("button", { name: "Sections" });
    expect(sections).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(sections);
    expect(sections).toHaveAttribute("aria-pressed", "false");
  });
});
