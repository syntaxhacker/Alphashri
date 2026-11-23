// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { DockSection } from "./DockSection";

afterEach(() => cleanup());

function renderSection() {
  return render(() => (
    <UIProvider>
      <DockSection
        title="LEGS"
        testId="section"
        headerTestId="section-header"
        meta={<span>meta</span>}
      >
        <span>body</span>
      </DockSection>
    </UIProvider>
  ));
}

describe("DockSection type scale and spacing", () => {
  test("header is a 40px band with a 14px title, never a 22px/10px strip", () => {
    renderSection();
    const header = screen.getByTestId("section-header");
    expect(header.className).toContain("h-10");
    expect(header.className).toContain("gap-3");
    expect(header.innerHTML).not.toContain("9px");
    expect(header.innerHTML).not.toContain("10px");

    const title = header.querySelector("p") as HTMLElement;
    expect(title.className).toContain("text-ui-label");
    expect(title.style.fontSize).toBe("");
    expect(title.className).toContain("tracking-[0.06em]");
  });

  test("body uses 12px padding and a 12px gap, with no 6px slop", () => {
    renderSection();
    const body = screen.getByTestId("section").children[1] as HTMLElement;
    expect(body.className).toContain("gap-3");
    expect(body.className).toContain("px-3");
    expect(body.className).toContain("py-3");
    expect(body.className).not.toContain("gap-1");
    expect(body.className).not.toContain("py-1.5");
  });

  test("inner separators use the semantic subtle border token", () => {
    renderSection();
    const section = screen.getByTestId("section");
    expect(section.className).toContain("border-t");
    expect(section.className).toContain("border-fin-border-subtle");
  });
});
