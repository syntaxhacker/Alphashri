// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { IconAlertCircle, IconRefresh, IconSearch, IconTable, IconX } from "./icons";

describe("ui icons", () => {
  it("renders a sizeless icon with the shared SVG contract", () => {
    render(() => <IconRefresh data-testid="icon" />);

    const svg = screen.getByTestId("icon");
    expect(svg.tagName.toLowerCase()).toBe("svg");
    expect(svg).toHaveAttribute("width", "24");
    expect(svg).toHaveAttribute("height", "24");
    expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
    expect(svg).toHaveAttribute("fill", "none");
    expect(svg).toHaveAttribute("stroke", "currentColor");
    expect(svg).toHaveAttribute("stroke-width", "2");
    expect(svg).toHaveAttribute("stroke-linecap", "round");
    expect(svg.querySelectorAll("path")).toHaveLength(1);
  });

  it("renders distinct glyphs from the same factory", () => {
    render(() => (
      <>
        <IconRefresh data-testid="refresh" />
        <IconTable data-testid="table" />
      </>
    ));

    const refreshPath = screen.getByTestId("refresh").querySelector("path")?.getAttribute("d") ?? "";
    const tablePath = screen.getByTestId("table").querySelector("path")?.getAttribute("d") ?? "";
    expect(refreshPath.length).toBeGreaterThan(20);
    expect(tablePath.length).toBeGreaterThan(20);
    expect(refreshPath).not.toBe(tablePath);
  });

  it("honours size, colour and stroke overrides, including string sizes", () => {
    render(() => (
      <>
        <IconAlertCircle data-testid="sized" size={32} stroke={1.5} color="var(--color-fin-warning)" />
        <IconSearch data-testid="string-sized" size="2rem" />
      </>
    ));

    const sized = screen.getByTestId("sized");
    expect(sized).toHaveAttribute("width", "32");
    expect(sized).toHaveAttribute("height", "32");
    expect(sized).toHaveAttribute("stroke", "var(--color-fin-warning)");
    expect(sized).toHaveAttribute("stroke-width", "1.5");

    const stringSized = screen.getByTestId("string-sized");
    expect(stringSized).toHaveAttribute("width", "2rem");
    expect(stringSized).toHaveAttribute("height", "2rem");
  });

  it("is hidden from AT by default; callers opt into labelled semantics", () => {
    render(() => (
      <>
        <IconX data-testid="bare" />
        <IconX data-testid="decorative" aria-hidden="true" />
        <IconX data-testid="labelled" role="img" aria-label="Close dialog" />
      </>
    ));

    const bare = screen.getByTestId("bare");
    expect(bare).toHaveAttribute("aria-hidden", "true");
    expect(bare).not.toHaveAttribute("role");
    expect(bare).not.toHaveAttribute("aria-label");

    expect(screen.getByTestId("decorative")).toHaveAttribute("aria-hidden", "true");
    const labelled = screen.getByTestId("labelled");
    expect(labelled).toHaveAttribute("aria-label", "Close dialog");
    expect(screen.getByRole("img", { name: "Close dialog" })).toBe(labelled);
  });

  it("forwards unknown SVG props safely without leaking wrapper-only props", () => {
    const onClick = vi.fn();
    render(() => (
      <IconSearch data-testid="icon" class="search-icon" data-icon-name="search" onClick={onClick} />
    ));

    const svg = screen.getByTestId("icon");
    expect(svg).toHaveClass("search-icon");
    expect(svg).toHaveAttribute("data-icon-name", "search");
    fireEvent.click(svg);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(svg).not.toHaveAttribute("size");
    expect(svg.querySelector("path")).not.toBeNull();
  });
});
