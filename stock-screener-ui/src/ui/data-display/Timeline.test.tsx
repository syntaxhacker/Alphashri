// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { Timeline } from "./Timeline";

const bullet = (item: HTMLElement) => item.querySelector(".ui-timeline-bullet") as HTMLElement;
const line = (item: HTMLElement) => item.querySelector(".ui-timeline-line") as HTMLElement;

describe("Timeline", () => {
  test("renders an ordered list of titled items with their bodies", () => {
    render(() => (
      <Timeline active={1} data-testid="timeline">
        <Timeline.Item title="10:00 · Scan" data-testid="first">214 symbols scanned.</Timeline.Item>
        <Timeline.Item title="10:01 · Filter" data-testid="second">18 rows left.</Timeline.Item>
      </Timeline>
    ));

    const list = screen.getByTestId("timeline");
    expect(list.tagName).toBe("OL");
    expect(list).toHaveClass("ui-timeline");
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0].querySelector("h3")).toHaveTextContent("10:00 · Scan");
    expect(screen.getByTestId("first")).toHaveTextContent("214 symbols scanned.");
    expect(screen.getByTestId("second")).toHaveTextContent("18 rows left.");
  });

  test("maps list and item colours to tone tokens, with the item winning", () => {
    render(() => (
      <Timeline color="success" data-testid="timeline">
        <Timeline.Item title="Inherited" data-testid="inherited">first</Timeline.Item>
        <Timeline.Item title="Override" color="error" data-testid="override">second</Timeline.Item>
        <Timeline.Item title="Alias" color="danger" data-testid="alias">third</Timeline.Item>
        <Timeline.Item title="Warning" color="warning" data-testid="warning">fourth</Timeline.Item>
        <Timeline.Item title="Info" color="info" data-testid="info">fifth</Timeline.Item>
        <Timeline.Item title="Muted" color="secondary" data-testid="muted">sixth</Timeline.Item>
      </Timeline>
    ));

    expect(bullet(screen.getByTestId("inherited")).className).toContain("bg-fin-positive");
    expect(bullet(screen.getByTestId("override")).className).toContain("bg-fin-negative");
    expect(bullet(screen.getByTestId("alias")).className).toContain("bg-fin-negative");
    expect(bullet(screen.getByTestId("warning")).className).toContain("bg-fin-warning");
    expect(bullet(screen.getByTestId("info")).className).toContain("bg-fin-info");
    expect(bullet(screen.getByTestId("muted")).className).toContain("bg-fin-text-muted");
  });

  test("custom bullets swap the filled token for a bordered token", () => {
    render(() => (
      <Timeline data-testid="timeline">
        <Timeline.Item title="Custom" bullet={<span data-testid="glyph">A</span>} data-testid="item">
          body
        </Timeline.Item>
      </Timeline>
    ));

    const item = screen.getByTestId("item");
    expect(bullet(item)).toContainElement(screen.getByTestId("glyph"));
    expect(bullet(item).className).toContain("bg-fin-surface");
    expect(bullet(item).className).toContain("border-fin-primary");
    expect(bullet(item).className).not.toContain("bg-fin-primary");
  });

  test("align, bullet size, line width and line variant change the rendered rail", () => {
    render(() => (
      <Timeline align="right" bulletSize={14} lineWidth={3} data-testid="timeline">
        <Timeline.Item title="Right" lineVariant="dashed" data-testid="item">body</Timeline.Item>
      </Timeline>
    ));

    expect(screen.getByTestId("timeline").className).toContain("items-end");
    const item = screen.getByTestId("item");
    expect(item.className).toContain("flex-row-reverse");
    expect(item.className).toContain("text-right");
    expect(bullet(item).className).toContain("w-[14px]");
    expect(bullet(item).className).toContain("h-[14px]");
    expect(line(item).className).toContain("w-[3px]");
    expect(line(item).className).toContain("border-l-dashed");
  });
});
